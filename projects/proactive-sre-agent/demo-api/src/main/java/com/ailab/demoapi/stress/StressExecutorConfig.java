package com.ailab.demoapi.stress;

import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class StressExecutorConfig {

    // A bounded queue + AbortPolicy is required for RejectedExecutionException to ever
    // actually fire. Executors.newFixedThreadPool uses an UNBOUNDED queue, which never
    // rejects -- excess tasks just queue silently forever instead of signalling capacity.
    @Bean(destroyMethod = "shutdownNow")
    public ExecutorService cpuStressExecutor() {
        return new ThreadPoolExecutor(
                4, 4, 0L, TimeUnit.MILLISECONDS,
                new ArrayBlockingQueue<>(8),
                new ThreadPoolExecutor.AbortPolicy());
    }

    @Bean(destroyMethod = "shutdownNow")
    public ExecutorService dbHoldExecutor() {
        return new ThreadPoolExecutor(
                5, 5, 0L, TimeUnit.MILLISECONDS,
                new ArrayBlockingQueue<>(8),
                new ThreadPoolExecutor.AbortPolicy());
    }
}
