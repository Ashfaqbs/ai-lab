package com.ailab.demoapi.stress;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/stress")
public class StressController {

    private final StressService stressService;

    public StressController(StressService stressService) {
        this.stressService = stressService;
    }

    @PostMapping("/cpu")
    public ResponseEntity<Void> cpu(@RequestParam int seconds) {
        stressService.startCpuStress(seconds);
        return ResponseEntity.status(HttpStatus.ACCEPTED).build();
    }

    @PostMapping("/memory")
    public ResponseEntity<Void> memory(@RequestParam int mb) {
        stressService.startMemoryStress(mb);
        return ResponseEntity.status(HttpStatus.ACCEPTED).build();
    }

    @PostMapping("/reset")
    public ResponseEntity<Void> reset() {
        stressService.resetMemory();
        return ResponseEntity.ok().build();
    }

    @PostMapping("/db-hold")
    public ResponseEntity<Void> dbHold(
            @RequestParam int connections, @RequestParam int seconds) {
        stressService.startDbHold(connections, seconds);
        return ResponseEntity.status(HttpStatus.ACCEPTED).build();
    }
}
