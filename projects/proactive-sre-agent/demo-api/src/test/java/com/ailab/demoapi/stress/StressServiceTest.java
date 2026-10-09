package com.ailab.demoapi.stress;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.awaitility.Awaitility.await;

import java.sql.Connection;
import java.sql.SQLException;
import java.time.Duration;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

class StressServiceTest {

    private ExecutorService cpuExecutor;
    private ExecutorService dbHoldExecutor;
    private StressService stressService;

    @BeforeEach
    void setUp() {
        cpuExecutor = Executors.newFixedThreadPool(2);
        dbHoldExecutor = Executors.newFixedThreadPool(2);
        stressService = new StressService(
                cpuExecutor, dbHoldExecutor, Mockito.mock(DataSource.class));
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
    void shouldReportOnlyAcquiredConnectionsWhenPoolCannotSatisfyRequest() throws SQLException {
        DataSource dataSource = Mockito.mock(DataSource.class);
        Connection c1 = Mockito.mock(Connection.class);
        Mockito.when(dataSource.getConnection())
                .thenReturn(c1)
                .thenThrow(new SQLException("pool exhausted"));

        StressService limitedService =
                new StressService(cpuExecutor, dbHoldExecutor, dataSource);

        int acquired = limitedService.acquireUpTo(dataSource, 3);

        assertThat(acquired).isEqualTo(1);
    }
}
