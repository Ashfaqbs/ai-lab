package com.ailab.demoapi.common;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.actuate.observability.AutoConfigureObservability;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.ResponseEntity;

// Spring Boot Test disables metrics export by default for test speed; this test's whole
// point is asserting on exported metrics, so it opts back in explicitly.
@AutoConfigureObservability
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class MetricsEndpointTest {

    @Autowired
    private TestRestTemplate restTemplate;

    @LocalServerPort
    private int port;

    @Test
    void shouldExposePrometheusMetricsWithExpectedSeries() {
        // http_server_requests_seconds_count for a request only appears after that
        // request completes, so a prior request is needed before the scrape sees it.
        restTemplate.getForEntity("/actuator/health", String.class);

        ResponseEntity<String> response =
                restTemplate.getForEntity("/actuator/prometheus", String.class);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody()).contains("http_server_requests_seconds_count");
        assertThat(response.getBody()).contains("hikaricp_connections_active");
    }
}
