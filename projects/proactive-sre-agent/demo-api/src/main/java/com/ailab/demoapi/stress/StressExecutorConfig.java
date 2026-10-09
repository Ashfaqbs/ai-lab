package com.ailab.demoapi.stress;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class StressExecutorConfig {

    @Bean(destroyMethod = "shutdownNow")
    public ExecutorService cpuStressExecutor() {
        return Executors.newFixedThreadPool(4);
    }

    @Bean(destroyMethod = "shutdownNow")
    public ExecutorService dbHoldExecutor() {
        return Executors.newFixedThreadPool(5);
    }
}
