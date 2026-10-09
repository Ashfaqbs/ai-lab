package com.ailab.demoapi.stress;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.concurrent.ExecutorService;
import org.junit.jupiter.api.Test;

class StressExecutorConfigTest {

    @Test
    void shouldCreateBoundedExecutors() {
        StressExecutorConfig config = new StressExecutorConfig();

        ExecutorService cpuExecutor = config.cpuStressExecutor();
        ExecutorService dbHoldExecutor = config.dbHoldExecutor();

        assertThat(cpuExecutor).isNotNull();
        assertThat(dbHoldExecutor).isNotNull();

        cpuExecutor.shutdownNow();
        dbHoldExecutor.shutdownNow();
    }
}
