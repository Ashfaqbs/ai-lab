package com.ailab.demoapi.stress;

import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PostConstruct;
import org.springframework.stereotype.Component;

@Component
public class StressMetricsInitializer {

    private final StressService stressService;
    private final MeterRegistry meterRegistry;

    public StressMetricsInitializer(StressService stressService, MeterRegistry meterRegistry) {
        this.stressService = stressService;
        this.meterRegistry = meterRegistry;
    }

    @PostConstruct
    void registerGauges() {
        stressService.registerGauges(meterRegistry);
    }
}
