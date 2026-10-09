package com.ailab.demoapi.stress;

import com.zaxxer.hikari.HikariDataSource;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

@Service
public class StressService {

    private static final Logger log = LoggerFactory.getLogger(StressService.class);

    private static final int BYTES_PER_MB = 1024 * 1024;
    private static final int MAX_MEMORY_MB = 256;
    private static final int MAX_SECONDS = 300;

    private final ExecutorService cpuStressExecutor;
    private final ExecutorService dbHoldExecutor;
    private final HikariDataSource dataSource;

    private final AtomicInteger activeCpuTasks = new AtomicInteger(0);
    private final AtomicLong retainedMemoryMb = new AtomicLong(0);
    private final List<byte[]> retainedMemory = new CopyOnWriteArrayList<>();

    public StressService(
            @Qualifier("cpuStressExecutor") ExecutorService cpuStressExecutor,
            @Qualifier("dbHoldExecutor") ExecutorService dbHoldExecutor,
            HikariDataSource dataSource) {
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
        if (seconds <= 0 || seconds > MAX_SECONDS) {
            throw new StressRequestValidationException(
                    "seconds must be between 1 and " + MAX_SECONDS);
        }
        try {
            cpuStressExecutor.submit(() -> {
                // Deadline is computed inside the task, once it actually starts
                // running -- computing it at submit time would make a task that waited
                // in the queue run for less than the requested duration, or not at all.
                long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(seconds);
                activeCpuTasks.incrementAndGet();
                try {
                    while (System.nanoTime() < deadline && !Thread.currentThread().isInterrupted()) {
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
        if (mb <= 0 || mb > MAX_MEMORY_MB) {
            throw new StressRequestValidationException(
                    "mb must be between 1 and " + MAX_MEMORY_MB);
        }
        // MAX_MEMORY_MB keeps mb * BYTES_PER_MB well within int range -- no overflow risk.
        retainedMemory.add(new byte[mb * BYTES_PER_MB]);
        retainedMemoryMb.addAndGet(mb);
    }

    public void resetMemory() {
        retainedMemory.clear();
        retainedMemoryMb.set(0);
    }

    public void startDbHold(int connections, int seconds) {
        if (connections <= 0 || seconds <= 0 || seconds > MAX_SECONDS) {
            throw new StressRequestValidationException(
                    "connections must be positive and seconds must be between 1 and "
                            + MAX_SECONDS);
        }
        int poolMax = dataSource.getMaximumPoolSize();
        if (connections > poolMax) {
            throw new StressRequestValidationException(
                    "connections (" + connections + ") exceeds the pool's maximum size ("
                            + poolMax + ") -- would block this task against its own request");
        }
        try {
            dbHoldExecutor.submit(() -> {
                List<Connection> held = new ArrayList<>();
                try {
                    for (int i = 0; i < connections; i++) {
                        held.add(dataSource.getConnection());
                    }
                    TimeUnit.SECONDS.sleep(seconds);
                } catch (SQLException ex) {
                    log.warn("db-hold could only acquire {} of {} requested connections",
                            held.size(), connections, ex);
                } catch (InterruptedException ex) {
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
