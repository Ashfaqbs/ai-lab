package com.ailab.demoapi.stress;

import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import javax.sql.DataSource;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

@Service
public class StressService {

    private static final int BYTES_PER_MB = 1024 * 1024;

    private final ExecutorService cpuStressExecutor;
    private final ExecutorService dbHoldExecutor;
    private final DataSource dataSource;

    private final AtomicInteger activeCpuTasks = new AtomicInteger(0);
    private final AtomicLong retainedMemoryMb = new AtomicLong(0);
    private final List<byte[]> retainedMemory = new CopyOnWriteArrayList<>();

    public StressService(
            @Qualifier("cpuStressExecutor") ExecutorService cpuStressExecutor,
            @Qualifier("dbHoldExecutor") ExecutorService dbHoldExecutor,
            DataSource dataSource) {
        this.cpuStressExecutor = cpuStressExecutor;
        this.dbHoldExecutor = dbHoldExecutor;
        this.dataSource = dataSource;
    }

    public void registerGauges(MeterRegistry registry) {
        Gauge.builder("stress_active_cpu_tasks", activeCpuTasks, AtomicInteger::get)
                .description("Number of currently running CPU-stress tasks")
                .register(registry);
        Gauge.builder("stress_retained_memory_mb", retainedMemoryMb, AtomicLong::get)
                .description("Megabytes currently retained by the memory-stress endpoint")
                .register(registry);
    }

    public void startCpuStress(int seconds) {
        if (seconds <= 0) {
            throw new StressRequestValidationException("seconds must be positive");
        }
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(seconds);
        try {
            cpuStressExecutor.submit(() -> {
                activeCpuTasks.incrementAndGet();
                try {
                    while (System.nanoTime() < deadline) {
                        Math.sqrt(Math.random());
                    }
                } finally {
                    activeCpuTasks.decrementAndGet();
                }
            });
        } catch (RejectedExecutionException ex) {
            throw new StressRequestValidationException(
                    "CPU stress executor is at capacity, task rejected");
        }
    }

    public void startMemoryStress(int mb) {
        if (mb <= 0) {
            throw new StressRequestValidationException("mb must be positive");
        }
        retainedMemory.add(new byte[mb * BYTES_PER_MB]);
        retainedMemoryMb.addAndGet(mb);
    }

    public void resetMemory() {
        retainedMemory.clear();
        retainedMemoryMb.set(0);
    }

    public void startDbHold(int connections, int seconds) {
        if (connections <= 0 || seconds <= 0) {
            throw new StressRequestValidationException(
                    "connections and seconds must both be positive");
        }
        try {
            dbHoldExecutor.submit(() -> {
                List<Connection> held = new CopyOnWriteArrayList<>();
                try {
                    for (int i = 0; i < connections; i++) {
                        held.add(dataSource.getConnection());
                    }
                    TimeUnit.SECONDS.sleep(seconds);
                } catch (SQLException | InterruptedException ex) {
                    Thread.currentThread().interrupt();
                } finally {
                    held.forEach(this::closeQuietly);
                }
            });
        } catch (RejectedExecutionException ex) {
            throw new StressRequestValidationException(
                    "DB-hold executor is at capacity, task rejected");
        }
    }

    /** Acquires up to {@code max} connections, stopping early if the pool is exhausted. */
    int acquireUpTo(DataSource source, int max) {
        int acquired = 0;
        for (int i = 0; i < max; i++) {
            try {
                source.getConnection();
                acquired++;
            } catch (SQLException ex) {
                break;
            }
        }
        return acquired;
    }

    public int getActiveCpuTasks() {
        return activeCpuTasks.get();
    }

    public long getRetainedMemoryMb() {
        return retainedMemoryMb.get();
    }

    private void closeQuietly(Connection connection) {
        try {
            connection.close();
        } catch (SQLException ignored) {
            // best-effort cleanup of a held stress connection
        }
    }
}
