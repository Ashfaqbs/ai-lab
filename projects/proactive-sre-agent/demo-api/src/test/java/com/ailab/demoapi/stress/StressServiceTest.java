package com.ailab.demoapi.stress;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.awaitility.Awaitility.await;

import com.zaxxer.hikari.HikariDataSource;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.Duration;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

class StressServiceTest {

    private ExecutorService cpuExecutor;
    private ExecutorService dbHoldExecutor;
    private HikariDataSource dataSource;
    private StressService stressService;

    @BeforeEach
    void setUp() {
        cpuExecutor = new ThreadPoolExecutor(
                2, 2, 0L, TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(1));
        dbHoldExecutor = new ThreadPoolExecutor(
                2, 2, 0L, TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(1));
        dataSource = Mockito.mock(HikariDataSource.class);
        Mockito.when(dataSource.getMaximumPoolSize()).thenReturn(5);
        stressService = new StressService(cpuExecutor, dbHoldExecutor, dataSource);
    }

    @AfterEach
    void tearDown() {
        cpuExecutor.shutdownNow();
        dbHoldExecutor.shutdownNow();
    }

    @Test
    void shouldRejectZeroOrNegativeCpuSeconds() {
        assertThatThrownBy(() -> stressService.startCpuStress(0))
                .isInstanceOf(StressRequestValidationException.class);
        assertThatThrownBy(() -> stressService.startCpuStress(-5))
                .isInstanceOf(StressRequestValidationException.class);
    }

    @Test
    void shouldIncrementThenDecrementActiveCpuTasksGauge() {
        assertThat(stressService.getActiveCpuTasks()).isZero();

        stressService.startCpuStress(1);

        await().atMost(Duration.ofMillis(500))
                .until(() -> stressService.getActiveCpuTasks() == 1);
        await().atMost(Duration.ofSeconds(3))
                .until(() -> stressService.getActiveCpuTasks() == 0);
    }

    @Test
    void shouldRejectZeroOrNegativeMemoryMb() {
        assertThatThrownBy(() -> stressService.startMemoryStress(0))
                .isInstanceOf(StressRequestValidationException.class);
    }

    @Test
    void shouldTrackAndResetRetainedMemory() {
        assertThat(stressService.getRetainedMemoryMb()).isZero();

        stressService.startMemoryStress(5);

        assertThat(stressService.getRetainedMemoryMb()).isEqualTo(5);

        stressService.resetMemory();

        assertThat(stressService.getRetainedMemoryMb()).isZero();
    }

    @Test
    void shouldRejectZeroOrNegativeDbHoldArgs() {
        assertThatThrownBy(() -> stressService.startDbHold(0, 1))
                .isInstanceOf(StressRequestValidationException.class);
        assertThatThrownBy(() -> stressService.startDbHold(1, 0))
                .isInstanceOf(StressRequestValidationException.class);
    }

    @Test
    void shouldRejectDbHoldWhenConnectionsExceedPoolMaxWithoutBlocking() {
        // Pool max is mocked to 5; requesting 6 must be rejected immediately rather
        // than blocking this task against its own impossible request.
        assertThatThrownBy(() -> stressService.startDbHold(6, 1))
                .isInstanceOf(StressRequestValidationException.class);
    }

    @Test
    void shouldAcquireAndReleaseExactlyTheRequestedConnectionsWithinPoolMax()
            throws SQLException, InterruptedException {
        Connection first = Mockito.mock(Connection.class);
        Connection second = Mockito.mock(Connection.class);
        CountDownLatch acquired = new CountDownLatch(1);
        Mockito.when(dataSource.getConnection())
                .thenAnswer(invocation -> {
                    acquired.countDown();
                    return first;
                })
                .thenReturn(second);

        stressService.startDbHold(2, 1);

        assertThat(acquired.await(2, TimeUnit.SECONDS)).isTrue();
        await().atMost(Duration.ofSeconds(3)).untilAsserted(() -> {
            Mockito.verify(first).close();
            Mockito.verify(second).close();
        });
    }

    @Test
    void shouldRejectCpuStressWhenExecutorIsAtCapacity() {
        // 2 threads + 1 queue slot = 3 total capacity. Fill it with short tasks, then
        // the next submission must be rejected rather than queuing unbounded.
        stressService.startCpuStress(2);
        stressService.startCpuStress(2);
        stressService.startCpuStress(2);

        assertThatThrownBy(() -> stressService.startCpuStress(2))
                .isInstanceOf(StressRequestValidationException.class);
    }
}
