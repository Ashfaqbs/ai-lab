package com.ailab.demoapi.order;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@Testcontainers
@SpringBootTest
class OrderIntegrationTest {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("demo")
            .withUsername("demo")
            .withPassword("demo");

    @DynamicPropertySource
    static void registerDbProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
    }

    @Autowired
    private OrderService orderService;

    @Test
    void shouldPersistAndReadBackOrderFromRealPostgres() {
        OrderResponse created = orderService.create(new OrderRequest("Ashfaq", "widget", 5));

        OrderResponse fetched = orderService.get(created.id());

        assertThat(fetched.customerName()).isEqualTo("Ashfaq");
        assertThat(fetched.quantity()).isEqualTo(5);
        assertThat(fetched.createdAt()).isNotNull();
    }
}
