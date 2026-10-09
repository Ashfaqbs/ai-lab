# Proactive SRE Agent — Phase 1 (Observable Base System) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy a Spring Boot + Postgres service with on-demand stress endpoints,
scraped by Prometheus and visualized in Grafana, running in a local `kind` cluster with a
baseline CPU-based HPA, plus a Python script that measures how long before a lagging
(failure) indicator a leading (stress) indicator starts climbing — proving the signals
Phase 2's agent will need actually exist and are measurable.

**Architecture:** One Spring Boot 3 service (`demo-api`) backed by Postgres, exposing CRUD
`/api/orders` endpoints and `/api/stress/*` endpoints that deliberately drive CPU, JVM
memory, and HikariCP pool exhaustion. Micrometer exposes both built-in and two custom
gauges at `/actuator/prometheus`. Prometheus scrapes `demo-api` (static target) and
`kube-state-metrics` (for HPA/restart visibility). Grafana visualizes it all. k6 generates
load as K8s Jobs. A Python script (`measure.py`) queries the Prometheus HTTP API directly
to compute the lead time between a leading indicator crossing its threshold and a lagging
indicator crossing its own.

**Tech Stack:** Java 17, Spring Boot 3.3.x, Spring Data JPA, Flyway, Micrometer +
`micrometer-registry-prometheus`, PostgreSQL 16, Docker, `kind`, Prometheus, Grafana,
`kube-state-metrics`, metrics-server, k6, Python 3.12 + `requests` + `pytest`.

**Spec:** [`designs/proactive-sre-agent/README.md`](../../../designs/proactive-sre-agent/README.md)

## Global Constraints

- Java 17, Spring Boot 3.3.x — matches the user's primary stack.
- Schema changes go through Flyway migrations; `ddl-auto` is never used.
- HikariCP `maximum-pool-size` is fixed at `5` — intentionally small so pool exhaustion is
  reachable without extreme load.
- `demo-api`'s K8s Deployment must set `resources.requests` and `resources.limits` (CPU and
  memory) — without limits, stress endpoints can't trigger real K8s-level throttling/OOM.
- No Ingress anywhere; all access is via `kubectl port-forward` (Grafana 3000, Prometheus
  9090, demo-api 8080).
- Every manifest's namespace is `ailab-poc`.
- Plain K8s YAML only — no Helm.
- Secrets (Postgres password, Grafana admin password) go through K8s `Secret` objects, not
  hardcoded in application code; values used are non-sensitive lab-only placeholders,
  clearly commented as such — this is a localhost-only `kind` cluster, never exposed.
- Conventional commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`), committed straight to
  `main` per this repo's documented convention, each commit ending with the attribution
  trailer from the session's system reminder.
- All code lives under `projects/proactive-sre-agent/` in the `ai-lab` repo.

## Review Focus

- Stress endpoints called with `0` or negative `seconds`/`mb`/`connections` — must return a
  clean `400`, not hang the JVM or throw an unhandled exception. (Task 4)
- Concurrent CPU-stress requests beyond the bounded executor's capacity — must queue or
  reject cleanly via `RejectedExecutionException` handling, never spawn unbounded threads.
  (Task 4)
- DB-hold requested with `connections` >= HikariCP's own pool size (5) — must not deadlock
  itself waiting for a connection it can never get; it should time out and report which
  connections it actually acquired. (Task 4)
- `measure.py` given a Prometheus range query that returns zero data points (metric never
  scraped, or scraped after the window) — must not crash; must report "no data" distinctly
  from "never crossed threshold". (Task 11)
- Order creation with invalid input (blank `customerName`, zero/negative `quantity`) — must
  return `400` with field-level errors, never a `500` or a silently-persisted bad row.
  (Task 1)

---

### Task 1: `demo-api` scaffold + Orders domain (CRUD, validated, DB-backed)

**Files:**
- Create: `projects/proactive-sre-agent/demo-api/pom.xml`
- Create: `projects/proactive-sre-agent/demo-api/src/main/resources/application.yml`
- Create: `projects/proactive-sre-agent/demo-api/src/main/resources/db/migration/V1__create_orders_table.sql`
- Create: `projects/proactive-sre-agent/demo-api/src/main/java/com/ailab/demoapi/DemoApiApplication.java`
- Create: `projects/proactive-sre-agent/demo-api/src/main/java/com/ailab/demoapi/order/Order.java`
- Create: `projects/proactive-sre-agent/demo-api/src/main/java/com/ailab/demoapi/order/OrderRepository.java`
- Create: `projects/proactive-sre-agent/demo-api/src/main/java/com/ailab/demoapi/order/OrderRequest.java`
- Create: `projects/proactive-sre-agent/demo-api/src/main/java/com/ailab/demoapi/order/OrderResponse.java`
- Create: `projects/proactive-sre-agent/demo-api/src/main/java/com/ailab/demoapi/order/OrderNotFoundException.java`
- Create: `projects/proactive-sre-agent/demo-api/src/main/java/com/ailab/demoapi/order/OrderService.java`
- Create: `projects/proactive-sre-agent/demo-api/src/main/java/com/ailab/demoapi/order/OrderController.java`
- Create: `projects/proactive-sre-agent/demo-api/src/main/java/com/ailab/demoapi/common/GlobalExceptionHandler.java`
- Test: `projects/proactive-sre-agent/demo-api/src/test/java/com/ailab/demoapi/order/OrderServiceTest.java`
- Test: `projects/proactive-sre-agent/demo-api/src/test/java/com/ailab/demoapi/order/OrderControllerTest.java`
- Test: `projects/proactive-sre-agent/demo-api/src/test/java/com/ailab/demoapi/order/OrderIntegrationTest.java`

**Interfaces:**
- Produces: `OrderService.create(OrderRequest) -> OrderResponse`,
  `OrderService.get(UUID) -> OrderResponse` (throws `OrderNotFoundException`),
  `OrderService.list() -> List<OrderResponse>`.
- Produces: `OrderRepository extends JpaRepository<Order, UUID>`.
- Produces: REST surface `POST /api/orders`, `GET /api/orders/{id}`, `GET /api/orders`.

- [ ] **Step 1: Write `pom.xml`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>

  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.3.4</version>
    <relativePath/>
  </parent>

  <groupId>com.ailab</groupId>
  <artifactId>demo-api</artifactId>
  <version>0.1.0</version>
  <name>demo-api</name>
  <description>Observable base service for the proactive-sre-agent lab</description>

  <properties>
    <java.version>17</java.version>
  </properties>

  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-data-jpa</artifactId>
    </dependency>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-validation</artifactId>
    </dependency>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-actuator</artifactId>
    </dependency>
    <dependency>
      <groupId>io.micrometer</groupId>
      <artifactId>micrometer-registry-prometheus</artifactId>
    </dependency>
    <dependency>
      <groupId>org.flywaydb</groupId>
      <artifactId>flyway-core</artifactId>
    </dependency>
    <dependency>
      <groupId>org.flywaydb</groupId>
      <artifactId>flyway-database-postgresql</artifactId>
    </dependency>
    <dependency>
      <groupId>org.postgresql</groupId>
      <artifactId>postgresql</artifactId>
      <scope>runtime</scope>
    </dependency>

    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-test</artifactId>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>org.testcontainers</groupId>
      <artifactId>junit-jupiter</artifactId>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>org.testcontainers</groupId>
      <artifactId>postgresql</artifactId>
      <scope>test</scope>
    </dependency>
  </dependencies>

  <dependencyManagement>
    <dependencies>
      <dependency>
        <groupId>org.testcontainers</groupId>
        <artifactId>testcontainers-bom</artifactId>
        <version>1.20.2</version>
        <type>pom</type>
        <scope>import</scope>
      </dependency>
    </dependencies>
  </dependencyManagement>

  <build>
    <plugins>
      <plugin>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-maven-plugin</artifactId>
      </plugin>
    </plugins>
  </build>
</project>
```

- [ ] **Step 2: Write `application.yml`**

```yaml
spring:
  application:
    name: demo-api
  datasource:
    url: jdbc:postgresql://${DB_HOST:localhost}:${DB_PORT:5432}/${DB_NAME:demo}
    username: ${DB_USER:demo}
    password: ${DB_PASSWORD:demo}
    hikari:
      maximum-pool-size: 5
      pool-name: demo-api-pool
  jpa:
    hibernate:
      ddl-auto: validate
    open-in-view: false
  flyway:
    enabled: true

management:
  endpoints:
    web:
      exposure:
        include: health,prometheus
  endpoint:
    health:
      probes:
        enabled: true
  metrics:
    tags:
      application: demo-api

server:
  port: 8080
```

- [ ] **Step 3: Write Flyway migration `V1__create_orders_table.sql`**

```sql
CREATE TABLE orders (
    id UUID PRIMARY KEY,
    customer_name VARCHAR(255) NOT NULL,
    item VARCHAR(255) NOT NULL,
    quantity INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);
```

- [ ] **Step 4: Write `DemoApiApplication.java`**

```java
package com.ailab.demoapi;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class DemoApiApplication {
    public static void main(String[] args) {
        SpringApplication.run(DemoApiApplication.class, args);
    }
}
```

- [ ] **Step 5: Write `Order.java` entity**

```java
package com.ailab.demoapi.order;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "orders")
public class Order {

    @Id
    private UUID id;

    @Column(name = "customer_name", nullable = false)
    private String customerName;

    @Column(nullable = false)
    private String item;

    @Column(nullable = false)
    private Integer quantity;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    protected Order() {
    }

    public Order(String customerName, String item, Integer quantity) {
        this.customerName = customerName;
        this.item = item;
        this.quantity = quantity;
    }

    @PrePersist
    void prePersist() {
        if (id == null) {
            id = UUID.randomUUID();
        }
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }

    public UUID getId() {
        return id;
    }

    public String getCustomerName() {
        return customerName;
    }

    public String getItem() {
        return item;
    }

    public Integer getQuantity() {
        return quantity;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
```

- [ ] **Step 6: Write `OrderRepository.java`**

```java
package com.ailab.demoapi.order;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface OrderRepository extends JpaRepository<Order, UUID> {
}
```

- [ ] **Step 7: Write `OrderRequest.java` and `OrderResponse.java`**

```java
package com.ailab.demoapi.order;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record OrderRequest(
        @NotBlank String customerName,
        @NotBlank String item,
        @NotNull @Min(1) Integer quantity) {
}
```

```java
package com.ailab.demoapi.order;

import java.time.Instant;
import java.util.UUID;

public record OrderResponse(
        UUID id,
        String customerName,
        String item,
        Integer quantity,
        Instant createdAt) {

    static OrderResponse from(Order order) {
        return new OrderResponse(
                order.getId(),
                order.getCustomerName(),
                order.getItem(),
                order.getQuantity(),
                order.getCreatedAt());
    }
}
```

- [ ] **Step 8: Write `OrderNotFoundException.java`**

```java
package com.ailab.demoapi.order;

import java.util.UUID;

public class OrderNotFoundException extends RuntimeException {
    public OrderNotFoundException(UUID id) {
        super("Order not found: " + id);
    }
}
```

- [ ] **Step 9: Write `OrderService.java`**

```java
package com.ailab.demoapi.order;

import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OrderService {

    private final OrderRepository orderRepository;

    public OrderService(OrderRepository orderRepository) {
        this.orderRepository = orderRepository;
    }

    @Transactional
    public OrderResponse create(OrderRequest request) {
        Order order = new Order(request.customerName(), request.item(), request.quantity());
        Order saved = orderRepository.save(order);
        return OrderResponse.from(saved);
    }

    @Transactional(readOnly = true)
    public OrderResponse get(UUID id) {
        return orderRepository.findById(id)
                .map(OrderResponse::from)
                .orElseThrow(() -> new OrderNotFoundException(id));
    }

    @Transactional(readOnly = true)
    public List<OrderResponse> list() {
        return orderRepository.findAll().stream().map(OrderResponse::from).toList();
    }
}
```

- [ ] **Step 10: Write `OrderController.java`**

```java
package com.ailab.demoapi.order;

import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/orders")
public class OrderController {

    private final OrderService orderService;

    public OrderController(OrderService orderService) {
        this.orderService = orderService;
    }

    @PostMapping
    public ResponseEntity<OrderResponse> create(@Valid @RequestBody OrderRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(orderService.create(request));
    }

    @GetMapping("/{id}")
    public OrderResponse get(@PathVariable UUID id) {
        return orderService.get(id);
    }

    @GetMapping
    public List<OrderResponse> list() {
        return orderService.list();
    }
}
```

- [ ] **Step 11: Write `GlobalExceptionHandler.java`**

```java
package com.ailab.demoapi.common;

import com.ailab.demoapi.order.OrderNotFoundException;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(OrderNotFoundException.class)
    public ResponseEntity<Map<String, Object>> handleNotFound(OrderNotFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(body(ex.getMessage()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<Map<String, Object>> handleValidation(MethodArgumentNotValidException ex) {
        Map<String, String> fieldErrors = new LinkedHashMap<>();
        ex.getBindingResult().getFieldErrors().forEach(
                error -> fieldErrors.put(error.getField(), error.getDefaultMessage()));
        Map<String, Object> body = body("Validation failed");
        body.put("fields", fieldErrors);
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(body);
    }

    private Map<String, Object> body(String message) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("timestamp", Instant.now().toString());
        body.put("message", message);
        return body;
    }
}
```

- [ ] **Step 12: Write `OrderServiceTest.java` (Mockito unit test)**

```java
package com.ailab.demoapi.order;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class OrderServiceTest {

    @Mock
    private OrderRepository orderRepository;

    @Test
    void shouldReturnOrderWhenIdExists() {
        Order order = new Order("Ashfaq", "widget", 2);
        when(orderRepository.findById(any())).thenReturn(Optional.of(order));

        OrderService service = new OrderService(orderRepository);
        OrderResponse response = service.get(UUID.randomUUID());

        assertThat(response.customerName()).isEqualTo("Ashfaq");
        assertThat(response.quantity()).isEqualTo(2);
    }

    @Test
    void shouldThrowWhenIdDoesNotExist() {
        when(orderRepository.findById(any())).thenReturn(Optional.empty());
        OrderService service = new OrderService(orderRepository);
        UUID missing = UUID.randomUUID();

        assertThatThrownBy(() -> service.get(missing))
                .isInstanceOf(OrderNotFoundException.class);
    }

    @Test
    void shouldSaveAndReturnOrderOnCreate() {
        when(orderRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        OrderService service = new OrderService(orderRepository);

        OrderResponse response = service.create(new OrderRequest("Ashfaq", "widget", 3));

        assertThat(response.item()).isEqualTo("widget");
        assertThat(response.quantity()).isEqualTo(3);
    }
}
```

- [ ] **Step 13: Write `OrderControllerTest.java` (MockMvc, incl. Review Focus validation case)**

```java
package com.ailab.demoapi.order;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(OrderController.class)
class OrderControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private OrderService orderService;

    @Test
    void shouldReturn201WhenCreateRequestIsValid() throws Exception {
        OrderResponse response = new OrderResponse(UUID.randomUUID(), "Ashfaq", "widget", 1, null);
        when(orderService.create(any())).thenReturn(response);

        mockMvc.perform(post("/api/orders")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new OrderRequest("Ashfaq", "widget", 1))))
                .andExpect(status().isCreated());
    }

    @Test
    void shouldReturn400WhenCustomerNameIsBlank() throws Exception {
        mockMvc.perform(post("/api/orders")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new OrderRequest("", "widget", 1))))
                .andExpect(status().isBadRequest());
    }

    @Test
    void shouldReturn400WhenQuantityIsZeroOrNegative() throws Exception {
        mockMvc.perform(post("/api/orders")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new OrderRequest("Ashfaq", "widget", 0))))
                .andExpect(status().isBadRequest());
    }

    @Test
    void shouldReturn404WhenOrderMissing() throws Exception {
        UUID missing = UUID.randomUUID();
        when(orderService.get(missing)).thenThrow(new OrderNotFoundException(missing));

        mockMvc.perform(get("/api/orders/{id}", missing))
                .andExpect(status().isNotFound());
    }
}
```

- [ ] **Step 14: Write `OrderIntegrationTest.java` (Testcontainers, real Postgres)**

```java
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
```

- [ ] **Step 15: Run the unit and MockMvc tests**

Run: `cd projects/proactive-sre-agent/demo-api && mvn -q test -Dtest=OrderServiceTest,OrderControllerTest`
Expected: `BUILD SUCCESS`, all tests pass.

- [ ] **Step 16: Run the Testcontainers integration test (requires Docker running)**

Run: `cd projects/proactive-sre-agent/demo-api && mvn -q test -Dtest=OrderIntegrationTest`
Expected: `BUILD SUCCESS` — Testcontainers pulls `postgres:16-alpine` and the test passes
against a real, ephemeral Postgres.

- [ ] **Step 17: Commit**

```bash
git add projects/proactive-sre-agent/demo-api
git commit -m "feat: scaffold demo-api with validated, DB-backed Orders CRUD

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PSHhhez8jcfcQqgd3bC1R5"
```

---

### Task 2: Actuator + Prometheus metrics exposure

**Files:**
- Modify: `projects/proactive-sre-agent/demo-api/src/main/resources/application.yml` (already exposes `prometheus`; verify in this task rather than re-edit)
- Test: `projects/proactive-sre-agent/demo-api/src/test/java/com/ailab/demoapi/common/MetricsEndpointTest.java`

**Interfaces:**
- Consumes: the running Spring context from Task 1 (no new production code).
- Produces: a verified contract — `GET /actuator/prometheus` returns `200` with
  `http_server_requests_seconds_count` and `hikaricp_connections_active` present — that
  Task 4's custom gauges and Task 8's Prometheus scrape config both depend on existing.

- [ ] **Step 1: Write the test**

```java
package com.ailab.demoapi.common;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.ResponseEntity;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class MetricsEndpointTest {

    @Autowired
    private TestRestTemplate restTemplate;

    @LocalServerPort
    private int port;

    @Test
    void shouldExposePrometheusMetricsWithExpectedSeries() {
        ResponseEntity<String> response =
                restTemplate.getForEntity("/actuator/prometheus", String.class);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody()).contains("http_server_requests_seconds_count");
        assertThat(response.getBody()).contains("hikaricp_connections_active");
    }
}
```

- [ ] **Step 2: Run test to verify it fails without a real DB** — it should actually pass
  if Task 1's app context starts; if it fails because no Postgres is reachable, that
  confirms the app needs a live DB for context startup, which is expected. For this test
  run a local Postgres first:

Run: `docker run --rm -d --name demo-api-metrics-test -e POSTGRES_DB=demo -e POSTGRES_USER=demo -e POSTGRES_PASSWORD=demo -p 5432:5432 postgres:16-alpine`
Run: `cd projects/proactive-sre-agent/demo-api && mvn -q test -Dtest=MetricsEndpointTest`
Expected: `BUILD SUCCESS`.

- [ ] **Step 3: Tear down the throwaway Postgres container**

Run: `docker stop demo-api-metrics-test`

- [ ] **Step 4: Commit**

```bash
git add projects/proactive-sre-agent/demo-api/src/test/java/com/ailab/demoapi/common/MetricsEndpointTest.java
git commit -m "test: verify /actuator/prometheus exposes HTTP and Hikari metrics

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PSHhhez8jcfcQqgd3bC1R5"
```

---

### Task 3: Bounded stress executors (config)

**Files:**
- Create: `projects/proactive-sre-agent/demo-api/src/main/java/com/ailab/demoapi/stress/StressExecutorConfig.java`
- Test: `projects/proactive-sre-agent/demo-api/src/test/java/com/ailab/demoapi/stress/StressExecutorConfigTest.java`

**Interfaces:**
- Produces: beans `@Qualifier("cpuStressExecutor") ExecutorService` (fixed pool size 4) and
  `@Qualifier("dbHoldExecutor") ExecutorService` (fixed pool size 5, matching HikariCP's max
  pool size) — consumed by `StressService` in Task 4.

- [ ] **Step 1: Write the test**

```java
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd projects/proactive-sre-agent/demo-api && mvn -q test -Dtest=StressExecutorConfigTest`
Expected: FAIL — `StressExecutorConfig` does not exist yet.

- [ ] **Step 3: Write `StressExecutorConfig.java`**

```java
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd projects/proactive-sre-agent/demo-api && mvn -q test -Dtest=StressExecutorConfigTest`
Expected: `BUILD SUCCESS`.

- [ ] **Step 5: Commit**

```bash
git add projects/proactive-sre-agent/demo-api/src/main/java/com/ailab/demoapi/stress/StressExecutorConfig.java projects/proactive-sre-agent/demo-api/src/test/java/com/ailab/demoapi/stress/StressExecutorConfigTest.java
git commit -m "feat: add bounded executors for stress endpoints

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PSHhhez8jcfcQqgd3bC1R5"
```

---

### Task 4: Stress endpoints — CPU, memory, DB-hold — with custom gauges

**Files:**
- Create: `projects/proactive-sre-agent/demo-api/src/main/java/com/ailab/demoapi/stress/StressService.java`
- Create: `projects/proactive-sre-agent/demo-api/src/main/java/com/ailab/demoapi/stress/StressController.java`
- Create: `projects/proactive-sre-agent/demo-api/src/main/java/com/ailab/demoapi/stress/StressRequestValidationException.java`
- Modify: `projects/proactive-sre-agent/demo-api/src/main/java/com/ailab/demoapi/common/GlobalExceptionHandler.java` (add handler for the new exception)
- Test: `projects/proactive-sre-agent/demo-api/src/test/java/com/ailab/demoapi/stress/StressServiceTest.java`
- Test: `projects/proactive-sre-agent/demo-api/src/test/java/com/ailab/demoapi/stress/StressControllerTest.java`

**Interfaces:**
- Consumes: `ExecutorService` beans from Task 3 via `@Qualifier`; `DataSource` (Spring
  Boot auto-configures this from the Task 1 `application.yml` settings); `MeterRegistry`
  (auto-configured by `micrometer-registry-prometheus`, verified present in Task 2).
- Produces: `StressService.startCpuStress(int seconds)`, `StressService.startMemoryStress(int mb)`,
  `StressService.resetMemory()`, `StressService.startDbHold(int connections, int seconds)`,
  `StressService.getActiveCpuTasks() -> int`, `StressService.getRetainedMemoryMb() -> long`.
  Two gauges registered under names `stress_active_cpu_tasks` and
  `stress_retained_memory_mb`, read by Task 9's Grafana dashboard and Task 11's `measure.py`.
  REST surface: `POST /api/stress/cpu`, `POST /api/stress/memory`, `POST /api/stress/reset`,
  `POST /api/stress/db-hold`.

- [ ] **Step 1: Write `StressRequestValidationException.java`**

```java
package com.ailab.demoapi.stress;

public class StressRequestValidationException extends RuntimeException {
    public StressRequestValidationException(String message) {
        super(message);
    }
}
```

- [ ] **Step 2: Write the failing test for `StressService`**

```java
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd projects/proactive-sre-agent/demo-api && mvn -q test -Dtest=StressServiceTest`
Expected: FAIL — `StressService` does not exist, and the `awaitility` dependency is missing.

- [ ] **Step 4: Add the `awaitility` test dependency to `pom.xml`**

Add inside `<dependencies>`, test scope, right after the Testcontainers dependencies:

```xml
    <dependency>
      <groupId>org.awaitility</groupId>
      <artifactId>awaitility</artifactId>
      <version>4.2.2</version>
      <scope>test</scope>
    </dependency>
```

- [ ] **Step 5: Write `StressService.java`**

```java
package com.ailab.demoapi.stress;

import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import javax.sql.DataSource;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

@Service
public class StressService {

    private static final int BYTES_PER_MB = 1024 * 1024;

    private final ExecutorService cpuStressExecutor;
    private final ExecutorService dbHoldExecutor;
    private final DataSource dataSource;

    private final AtomicInteger activeCpuTasks = new AtomicInteger(0);
    private final AtomicLong retainedMemoryMb = new AtomicLong(0);
    private final List<byte[]> retainedMemory = new CopyOnWriteArrayList<>();

    public StressService(
            @Qualifier("cpuStressExecutor") ExecutorService cpuStressExecutor,
            @Qualifier("dbHoldExecutor") ExecutorService dbHoldExecutor,
            DataSource dataSource) {
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
        if (seconds <= 0) {
            throw new StressRequestValidationException("seconds must be positive");
        }
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(seconds);
        try {
            cpuStressExecutor.submit(() -> {
                activeCpuTasks.incrementAndGet();
                try {
                    while (System.nanoTime() < deadline) {
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
        if (mb <= 0) {
            throw new StressRequestValidationException("mb must be positive");
        }
        retainedMemory.add(new byte[mb * BYTES_PER_MB]);
        retainedMemoryMb.addAndGet(mb);
    }

    public void resetMemory() {
        retainedMemory.clear();
        retainedMemoryMb.set(0);
    }

    public void startDbHold(int connections, int seconds) {
        if (connections <= 0 || seconds <= 0) {
            throw new StressRequestValidationException(
                    "connections and seconds must both be positive");
        }
        try {
            dbHoldExecutor.submit(() -> {
                List<Connection> held = new CopyOnWriteArrayList<>();
                try {
                    for (int i = 0; i < connections; i++) {
                        held.add(dataSource.getConnection());
                    }
                    TimeUnit.SECONDS.sleep(seconds);
                } catch (SQLException | InterruptedException ex) {
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

    /** Acquires up to {@code max} connections, stopping early if the pool is exhausted. */
    int acquireUpTo(DataSource source, int max) {
        int acquired = 0;
        for (int i = 0; i < max; i++) {
            try {
                source.getConnection();
                acquired++;
            } catch (SQLException ex) {
                break;
            }
        }
        return acquired;
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
```

- [ ] **Step 6: Register the gauges at startup — add a small `@PostConstruct`-style wiring
  bean so `StressService` doesn't depend on `MeterRegistry` in its constructor (keeps the
  constructor test-friendly as used in Step 2's unit test)**

Create `projects/proactive-sre-agent/demo-api/src/main/java/com/ailab/demoapi/stress/StressMetricsInitializer.java`:

```java
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
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd projects/proactive-sre-agent/demo-api && mvn -q test -Dtest=StressServiceTest`
Expected: `BUILD SUCCESS`.

- [ ] **Step 8: Write the failing test for `StressController`**

```java
package com.ailab.demoapi.stress;

import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.doThrow;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(StressController.class)
class StressControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private StressService stressService;

    @Test
    void shouldReturn202WhenCpuStressAccepted() throws Exception {
        mockMvc.perform(post("/api/stress/cpu").param("seconds", "1"))
                .andExpect(status().isAccepted());
    }

    @Test
    void shouldReturn400WhenCpuSecondsInvalid() throws Exception {
        doThrow(new StressRequestValidationException("seconds must be positive"))
                .when(stressService).startCpuStress(anyInt());

        mockMvc.perform(post("/api/stress/cpu").param("seconds", "0"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void shouldReturn202WhenMemoryStressAccepted() throws Exception {
        mockMvc.perform(post("/api/stress/memory").param("mb", "10"))
                .andExpect(status().isAccepted());
    }

    @Test
    void shouldReturn200OnReset() throws Exception {
        mockMvc.perform(post("/api/stress/reset"))
                .andExpect(status().isOk());
    }

    @Test
    void shouldReturn202WhenDbHoldAccepted() throws Exception {
        mockMvc.perform(post("/api/stress/db-hold")
                        .param("connections", "2")
                        .param("seconds", "1"))
                .andExpect(status().isAccepted());
    }
}
```

- [ ] **Step 9: Run test to verify it fails**

Run: `cd projects/proactive-sre-agent/demo-api && mvn -q test -Dtest=StressControllerTest`
Expected: FAIL — `StressController` does not exist.

- [ ] **Step 10: Write `StressController.java`**

```java
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
```

- [ ] **Step 11: Add the new exception to `GlobalExceptionHandler.java`**

Modify `projects/proactive-sre-agent/demo-api/src/main/java/com/ailab/demoapi/common/GlobalExceptionHandler.java`
— add this import: `import com.ailab.demoapi.stress.StressRequestValidationException;`
— add this handler method inside the class:

```java
    @ExceptionHandler(StressRequestValidationException.class)
    public ResponseEntity<Map<String, Object>> handleStressValidation(
            StressRequestValidationException ex) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(body(ex.getMessage()));
    }
```

- [ ] **Step 12: Run test to verify it passes**

Run: `cd projects/proactive-sre-agent/demo-api && mvn -q test -Dtest=StressControllerTest`
Expected: `BUILD SUCCESS`.

- [ ] **Step 13: Run the full test suite**

Run: `cd projects/proactive-sre-agent/demo-api && mvn -q test`
Expected: `BUILD SUCCESS`, all tests from Tasks 1-4 pass.

- [ ] **Step 14: Commit**

```bash
git add projects/proactive-sre-agent/demo-api
git commit -m "feat: add CPU, memory, and DB-hold stress endpoints with custom gauges

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PSHhhez8jcfcQqgd3bC1R5"
```

---

### Task 5: Dockerize `demo-api`

**Files:**
- Create: `projects/proactive-sre-agent/demo-api/Dockerfile`
- Create: `projects/proactive-sre-agent/demo-api/.dockerignore`

**Interfaces:**
- Produces: image tag `ailab/demo-api:local`, consumed by Task 6's `kind load docker-image`
  step and the `scripts/build-and-load.sh` in Task 12.

- [ ] **Step 1: Write `.dockerignore`**

```
target/
.git/
*.md
```

- [ ] **Step 2: Write `Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1

FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /build
COPY pom.xml .
RUN mvn -q dependency:go-offline
COPY src ./src
RUN mvn -q package -DskipTests

FROM eclipse-temurin:17-jre-alpine
RUN apk add --no-cache curl \
    && addgroup -S appgroup \
    && adduser -S appuser -G appgroup
WORKDIR /app
COPY --from=build /build/target/demo-api-0.1.0.jar app.jar
USER appuser
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
    CMD curl -f http://localhost:8080/actuator/health || exit 1
ENTRYPOINT ["java", "-jar", "app.jar"]
```

- [ ] **Step 3: Build the image**

Run: `cd projects/proactive-sre-agent/demo-api && docker build -t ailab/demo-api:local .`
Expected: image builds successfully, final `exporting layers` step completes.

- [ ] **Step 4: Smoke-test the image locally against a throwaway Postgres**

```bash
docker network create ailab-poc-smoke
docker run --rm -d --name smoke-pg --network ailab-poc-smoke \
  -e POSTGRES_DB=demo -e POSTGRES_USER=demo -e POSTGRES_PASSWORD=demo \
  postgres:16-alpine
sleep 5
docker run --rm -d --name smoke-api --network ailab-poc-smoke -p 8080:8080 \
  -e DB_HOST=smoke-pg -e DB_USER=demo -e DB_PASSWORD=demo \
  ailab/demo-api:local
sleep 10
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/actuator/health
curl -s -X POST http://localhost:8080/api/orders \
  -H "Content-Type: application/json" \
  -d '{"customerName":"Ashfaq","item":"widget","quantity":2}'
docker stop smoke-api smoke-pg
docker network rm ailab-poc-smoke
```

Expected: health check prints `200`; the `POST /api/orders` call returns a `201` JSON body
with a generated `id`.

- [ ] **Step 5: Commit**

```bash
git add projects/proactive-sre-agent/demo-api/Dockerfile projects/proactive-sre-agent/demo-api/.dockerignore
git commit -m "chore: add multi-stage Dockerfile for demo-api

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PSHhhez8jcfcQqgd3bC1R5"
```

---

### Task 6: `kind` cluster + namespace + Postgres manifests

**Files:**
- Create: `projects/proactive-sre-agent/scripts/setup-kind.sh`
- Create: `projects/proactive-sre-agent/k8s/00-namespace.yaml`
- Create: `projects/proactive-sre-agent/k8s/05-postgres-secret.yaml`
- Create: `projects/proactive-sre-agent/k8s/10-postgres.yaml`

**Interfaces:**
- Produces: namespace `ailab-poc`; `Secret/postgres-credentials` (keys `username`,
  `password`) and `Service/postgres` (port 5432), both consumed by Task 7's `demo-api`
  Deployment.

- [ ] **Step 1: Write `setup-kind.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

CLUSTER_NAME="ailab-poc"

if ! command -v kind >/dev/null 2>&1; then
  echo "kind not found. Install: go install sigs.k8s.io/kind@v0.24.0 (requires Go), or see https://kind.sigs.k8s.io/docs/user/quick-start/#installation"
  exit 1
fi

if kind get clusters | grep -qx "${CLUSTER_NAME}"; then
  echo "kind cluster '${CLUSTER_NAME}' already exists, skipping create"
else
  kind create cluster --name "${CLUSTER_NAME}"
fi

kubectl config use-context "kind-${CLUSTER_NAME}"

# metrics-server is required for the demo-api HPA (Task 7) to read live CPU usage.
# kind's kubelet serving certs aren't verified by the default metrics-server manifest,
# so we patch in --kubelet-insecure-tls (acceptable for a local lab cluster only).
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
kubectl patch -n kube-system deployment metrics-server --type=json \
  -p '[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'

echo "kind cluster '${CLUSTER_NAME}' ready, metrics-server patched for insecure TLS."
```

- [ ] **Step 2: Make it executable and run it**

Run: `chmod +x projects/proactive-sre-agent/scripts/setup-kind.sh && projects/proactive-sre-agent/scripts/setup-kind.sh`
Expected: cluster `ailab-poc` created (or already-exists message), `metrics-server`
patched, `kubectl config current-context` prints `kind-ailab-poc`.

- [ ] **Step 3: Write `00-namespace.yaml`**

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: ailab-poc
```

- [ ] **Step 4: Write `05-postgres-secret.yaml`**

```yaml
# Lab-only placeholder credentials for a Postgres instance that never leaves this
# localhost-only kind cluster. Not a pattern to reuse for anything internet-facing.
apiVersion: v1
kind: Secret
metadata:
  name: postgres-credentials
  namespace: ailab-poc
type: Opaque
stringData:
  username: demo
  password: demo
```

- [ ] **Step 5: Write `10-postgres.yaml`**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: postgres
  namespace: ailab-poc
spec:
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
        - name: postgres
          image: postgres:16-alpine
          ports:
            - containerPort: 5432
          env:
            - name: POSTGRES_DB
              value: demo
            - name: POSTGRES_USER
              valueFrom:
                secretKeyRef:
                  name: postgres-credentials
                  key: username
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: postgres-credentials
                  key: password
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 250m
              memory: 256Mi
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
              subPath: pgdata
      volumes:
        - name: data
          emptyDir: {}
---
apiVersion: v1
kind: Service
metadata:
  name: postgres
  namespace: ailab-poc
spec:
  selector:
    app: postgres
  ports:
    - port: 5432
      targetPort: 5432
```

- [ ] **Step 6: Apply and verify**

```bash
kubectl apply -f projects/proactive-sre-agent/k8s/00-namespace.yaml
kubectl apply -f projects/proactive-sre-agent/k8s/05-postgres-secret.yaml
kubectl apply -f projects/proactive-sre-agent/k8s/10-postgres.yaml
kubectl -n ailab-poc rollout status deployment/postgres --timeout=60s
kubectl -n ailab-poc exec deploy/postgres -- psql -U demo -d demo -c "SELECT 1;"
```

Expected: rollout succeeds; `psql` prints a one-row `1` result confirming Postgres accepts
connections with the Secret-sourced credentials.

- [ ] **Step 7: Commit**

```bash
git add projects/proactive-sre-agent/scripts/setup-kind.sh projects/proactive-sre-agent/k8s/00-namespace.yaml projects/proactive-sre-agent/k8s/05-postgres-secret.yaml projects/proactive-sre-agent/k8s/10-postgres.yaml
git commit -m "feat: add kind cluster setup script and Postgres manifests

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PSHhhez8jcfcQqgd3bC1R5"
```

---

### Task 7: `demo-api` Deployment/Service + HPA

**Files:**
- Create: `projects/proactive-sre-agent/scripts/build-and-load.sh`
- Create: `projects/proactive-sre-agent/k8s/20-demo-api.yaml`

**Interfaces:**
- Consumes: `Service/postgres` and `Secret/postgres-credentials` from Task 6; image
  `ailab/demo-api:local` from Task 5.
- Produces: `Service/demo-api` (port 8080), consumed by Task 8's Prometheus scrape config
  and Task 10's k6 scripts; `HorizontalPodAutoscaler/demo-api` — the reactive baseline the
  spec requires for later comparison.

- [ ] **Step 1: Write `build-and-load.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

IMAGE="ailab/demo-api:local"
CLUSTER_NAME="ailab-poc"

docker build -t "${IMAGE}" projects/proactive-sre-agent/demo-api
kind load docker-image "${IMAGE}" --name "${CLUSTER_NAME}"

echo "Built and loaded ${IMAGE} into kind cluster ${CLUSTER_NAME}."
```

- [ ] **Step 2: Run it**

Run: `chmod +x projects/proactive-sre-agent/scripts/build-and-load.sh && projects/proactive-sre-agent/scripts/build-and-load.sh`
Expected: image builds, `kind load docker-image` completes without error.

- [ ] **Step 3: Write `20-demo-api.yaml`**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo-api
  namespace: ailab-poc
spec:
  replicas: 1
  selector:
    matchLabels:
      app: demo-api
  template:
    metadata:
      labels:
        app: demo-api
    spec:
      containers:
        - name: demo-api
          image: ailab/demo-api:local
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 8080
          env:
            - name: DB_HOST
              value: postgres
            - name: DB_PORT
              value: "5432"
            - name: DB_NAME
              value: demo
            - name: DB_USER
              valueFrom:
                secretKeyRef:
                  name: postgres-credentials
                  key: username
            - name: DB_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: postgres-credentials
                  key: password
          resources:
            requests:
              cpu: 250m
              memory: 256Mi
            limits:
              cpu: 500m
              memory: 512Mi
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: 8080
            initialDelaySeconds: 20
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: 8080
            initialDelaySeconds: 10
            periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: demo-api
  namespace: ailab-poc
spec:
  selector:
    app: demo-api
  ports:
    - port: 8080
      targetPort: 8080
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: demo-api
  namespace: ailab-poc
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: demo-api
  minReplicas: 1
  maxReplicas: 4
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 60
```

- [ ] **Step 4: Apply and verify rollout**

```bash
kubectl apply -f projects/proactive-sre-agent/k8s/20-demo-api.yaml
kubectl -n ailab-poc rollout status deployment/demo-api --timeout=90s
kubectl -n ailab-poc get hpa demo-api
```

Expected: rollout succeeds; `kubectl get hpa` shows `TARGETS` as a CPU percentage (not
`<unknown>` — if it shows `<unknown>` for more than a minute, `metrics-server` from Task 6
Step 1 isn't ready yet; re-check with `kubectl -n kube-system get pods | grep metrics-server`).

- [ ] **Step 5: Verify CRUD end-to-end through the cluster**

```bash
kubectl -n ailab-poc port-forward svc/demo-api 8080:8080 &
PF_PID=$!
sleep 3
curl -s -X POST http://localhost:8080/api/orders \
  -H "Content-Type: application/json" \
  -d '{"customerName":"Ashfaq","item":"widget","quantity":4}'
kill "${PF_PID}"
```

Expected: `201` response with a generated order `id`, proving `demo-api` in the cluster
can reach the `postgres` Service and complete a real write.

- [ ] **Step 6: Commit**

```bash
git add projects/proactive-sre-agent/scripts/build-and-load.sh projects/proactive-sre-agent/k8s/20-demo-api.yaml
git commit -m "feat: deploy demo-api to kind with resource limits and a CPU-based HPA

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PSHhhez8jcfcQqgd3bC1R5"
```

---

### Task 8: Prometheus manifests (static scrape config, no RBAC needed)

**Files:**
- Create: `projects/proactive-sre-agent/k8s/30-prometheus.yaml`

**Interfaces:**
- Consumes: `Service/demo-api` from Task 7 (static scrape target
  `demo-api.ailab-poc.svc.cluster.local:8080`).
- Produces: `Service/prometheus` (port 9090), consumed by Task 9's Grafana datasource and
  Task 11's `measure.py` via port-forward.

- [ ] **Step 1: Write `30-prometheus.yaml`**

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: prometheus-config
  namespace: ailab-poc
data:
  prometheus.yml: |
    global:
      scrape_interval: 5s
    scrape_configs:
      - job_name: demo-api
        metrics_path: /actuator/prometheus
        static_configs:
          - targets: ["demo-api.ailab-poc.svc.cluster.local:8080"]
      - job_name: kube-state-metrics
        static_configs:
          - targets: ["kube-state-metrics.ailab-poc.svc.cluster.local:8080"]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: prometheus
  namespace: ailab-poc
spec:
  replicas: 1
  selector:
    matchLabels:
      app: prometheus
  template:
    metadata:
      labels:
        app: prometheus
    spec:
      containers:
        - name: prometheus
          image: prom/prometheus:v2.54.1
          args:
            - --config.file=/etc/prometheus/prometheus.yml
          ports:
            - containerPort: 9090
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
            limits:
              cpu: 500m
              memory: 512Mi
          volumeMounts:
            - name: config
              mountPath: /etc/prometheus
      volumes:
        - name: config
          configMap:
            name: prometheus-config
---
apiVersion: v1
kind: Service
metadata:
  name: prometheus
  namespace: ailab-poc
spec:
  selector:
    app: prometheus
  ports:
    - port: 9090
      targetPort: 9090
```

- [ ] **Step 2: Apply (note: `kube-state-metrics` target won't resolve until Task 9 — that's
  expected, Prometheus marks it `down` without failing)**

```bash
kubectl apply -f projects/proactive-sre-agent/k8s/30-prometheus.yaml
kubectl -n ailab-poc rollout status deployment/prometheus --timeout=60s
```

- [ ] **Step 3: Verify the `demo-api` target is up**

```bash
kubectl -n ailab-poc port-forward svc/prometheus 9090:9090 &
PF_PID=$!
sleep 3
curl -s http://localhost:9090/api/v1/targets | grep -o '"job":"demo-api"[^}]*"health":"[a-z]*"'
kill "${PF_PID}"
```

Expected: output includes `"health":"up"` for the `demo-api` job.

- [ ] **Step 4: Commit**

```bash
git add projects/proactive-sre-agent/k8s/30-prometheus.yaml
git commit -m "feat: deploy Prometheus with a static scrape config for demo-api

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PSHhhez8jcfcQqgd3bC1R5"
```

---

### Task 9: Grafana + `kube-state-metrics` manifests

**Files:**
- Create: `projects/proactive-sre-agent/k8s/40-grafana-secret.yaml`
- Create: `projects/proactive-sre-agent/k8s/40-grafana.yaml`
- Create: `projects/proactive-sre-agent/k8s/40-grafana-dashboard.yaml`
- Create: `projects/proactive-sre-agent/k8s/50-kube-state-metrics.yaml`

**Interfaces:**
- Consumes: `Service/prometheus` from Task 8.
- Produces: `Service/grafana` (port 3000), viewable via port-forward; `Service/kube-state-metrics`
  (port 8080) scraped by the Task 8 config already in place.

- [ ] **Step 1: Write `40-grafana-secret.yaml`**

```yaml
# Lab-only placeholder credential for a Grafana instance only ever reached via
# kubectl port-forward on localhost. Not a pattern to reuse for anything internet-facing.
apiVersion: v1
kind: Secret
metadata:
  name: grafana-credentials
  namespace: ailab-poc
type: Opaque
stringData:
  admin-password: admin
```

- [ ] **Step 2: Write `40-grafana-dashboard.yaml`** (dashboard JSON as a ConfigMap)

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: grafana-dashboard-demo-api
  namespace: ailab-poc
data:
  demo-api.json: |
    {
      "title": "demo-api: leading vs lagging indicators",
      "schemaVersion": 39,
      "panels": [
        {
          "title": "HTTP request rate",
          "type": "timeseries",
          "gridPos": {"h": 8, "w": 12, "x": 0, "y": 0},
          "targets": [{"expr": "sum(rate(http_server_requests_seconds_count{job=\"demo-api\"}[1m]))"}]
        },
        {
          "title": "HTTP error rate (5xx)",
          "type": "timeseries",
          "gridPos": {"h": 8, "w": 12, "x": 12, "y": 0},
          "targets": [{"expr": "sum(rate(http_server_requests_seconds_count{job=\"demo-api\",status=~\"5..\"}[1m]))"}]
        },
        {
          "title": "p99 latency",
          "type": "timeseries",
          "gridPos": {"h": 8, "w": 12, "x": 0, "y": 8},
          "targets": [{"expr": "histogram_quantile(0.99, sum(rate(http_server_requests_seconds_bucket{job=\"demo-api\"}[1m])) by (le))"}]
        },
        {
          "title": "JVM heap used",
          "type": "timeseries",
          "gridPos": {"h": 8, "w": 12, "x": 12, "y": 8},
          "targets": [{"expr": "jvm_memory_used_bytes{job=\"demo-api\",area=\"heap\"}"}]
        },
        {
          "title": "Hikari active / pending connections",
          "type": "timeseries",
          "gridPos": {"h": 8, "w": 12, "x": 0, "y": 16},
          "targets": [
            {"expr": "hikaricp_connections_active{job=\"demo-api\"}"},
            {"expr": "hikaricp_connections_pending{job=\"demo-api\"}"}
          ]
        },
        {
          "title": "stress_active_cpu_tasks / stress_retained_memory_mb",
          "type": "timeseries",
          "gridPos": {"h": 8, "w": 12, "x": 12, "y": 16},
          "targets": [
            {"expr": "stress_active_cpu_tasks{job=\"demo-api\"}"},
            {"expr": "stress_retained_memory_mb{job=\"demo-api\"}"}
          ]
        },
        {
          "title": "HPA current replicas (reactive baseline)",
          "type": "timeseries",
          "gridPos": {"h": 8, "w": 12, "x": 0, "y": 24},
          "targets": [{"expr": "kube_horizontalpodautoscaler_status_current_replicas{namespace=\"ailab-poc\",horizontalpodautoscaler=\"demo-api\"}"}]
        }
      ]
    }
```

- [ ] **Step 3: Write `40-grafana.yaml`**

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: grafana-provisioning
  namespace: ailab-poc
data:
  datasource.yaml: |
    apiVersion: 1
    datasources:
      - name: Prometheus
        type: prometheus
        access: proxy
        url: http://prometheus.ailab-poc.svc.cluster.local:9090
        isDefault: true
  dashboards.yaml: |
    apiVersion: 1
    providers:
      - name: demo-api
        folder: ""
        type: file
        options:
          path: /var/lib/grafana/dashboards
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: grafana
  namespace: ailab-poc
spec:
  replicas: 1
  selector:
    matchLabels:
      app: grafana
  template:
    metadata:
      labels:
        app: grafana
    spec:
      containers:
        - name: grafana
          image: grafana/grafana:11.2.2
          ports:
            - containerPort: 3000
          env:
            - name: GF_SECURITY_ADMIN_USER
              value: admin
            - name: GF_SECURITY_ADMIN_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: grafana-credentials
                  key: admin-password
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 250m
              memory: 256Mi
          volumeMounts:
            - name: datasource
              mountPath: /etc/grafana/provisioning/datasources
            - name: dashboard-provider
              mountPath: /etc/grafana/provisioning/dashboards
            - name: dashboard-json
              mountPath: /var/lib/grafana/dashboards
      volumes:
        - name: datasource
          configMap:
            name: grafana-provisioning
            items:
              - key: datasource.yaml
                path: datasource.yaml
        - name: dashboard-provider
          configMap:
            name: grafana-provisioning
            items:
              - key: dashboards.yaml
                path: dashboards.yaml
        - name: dashboard-json
          configMap:
            name: grafana-dashboard-demo-api
---
apiVersion: v1
kind: Service
metadata:
  name: grafana
  namespace: ailab-poc
spec:
  selector:
    app: grafana
  ports:
    - port: 3000
      targetPort: 3000
```

- [ ] **Step 4: Write `50-kube-state-metrics.yaml`**

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: kube-state-metrics
  namespace: ailab-poc
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: kube-state-metrics-ailab-poc
rules:
  - apiGroups: ["apps"]
    resources: ["deployments", "replicasets"]
    verbs: ["list", "watch"]
  - apiGroups: ["autoscaling"]
    resources: ["horizontalpodautoscalers"]
    verbs: ["list", "watch"]
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: kube-state-metrics-ailab-poc
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: kube-state-metrics-ailab-poc
subjects:
  - kind: ServiceAccount
    name: kube-state-metrics
    namespace: ailab-poc
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: kube-state-metrics
  namespace: ailab-poc
spec:
  replicas: 1
  selector:
    matchLabels:
      app: kube-state-metrics
  template:
    metadata:
      labels:
        app: kube-state-metrics
    spec:
      serviceAccountName: kube-state-metrics
      containers:
        - name: kube-state-metrics
          image: registry.k8s.io/kube-state-metrics/kube-state-metrics:v2.13.0
          ports:
            - containerPort: 8080
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              cpu: 100m
              memory: 128Mi
---
apiVersion: v1
kind: Service
metadata:
  name: kube-state-metrics
  namespace: ailab-poc
spec:
  selector:
    app: kube-state-metrics
  ports:
    - port: 8080
      targetPort: 8080
```

- [ ] **Step 5: Apply everything and verify**

```bash
kubectl apply -f projects/proactive-sre-agent/k8s/50-kube-state-metrics.yaml
kubectl apply -f projects/proactive-sre-agent/k8s/40-grafana-secret.yaml
kubectl apply -f projects/proactive-sre-agent/k8s/40-grafana-dashboard.yaml
kubectl apply -f projects/proactive-sre-agent/k8s/40-grafana.yaml
kubectl -n ailab-poc rollout status deployment/kube-state-metrics --timeout=60s
kubectl -n ailab-poc rollout status deployment/grafana --timeout=60s
```

- [ ] **Step 6: Verify the dashboard renders real data**

```bash
kubectl -n ailab-poc port-forward svc/grafana 3000:3000 &
PF_PID=$!
sleep 3
curl -s -u admin:admin http://localhost:3000/api/search | grep -o '"title":"demo-api[^"]*"'
kill "${PF_PID}"
```

Expected: output includes the dashboard title, confirming Grafana auto-provisioned it from
the ConfigMap. (Open `http://localhost:3000` in a browser for a visual check too — login
`admin`/`admin`.)

- [ ] **Step 7: Commit**

```bash
git add projects/proactive-sre-agent/k8s/40-grafana-secret.yaml projects/proactive-sre-agent/k8s/40-grafana.yaml projects/proactive-sre-agent/k8s/40-grafana-dashboard.yaml projects/proactive-sre-agent/k8s/50-kube-state-metrics.yaml
git commit -m "feat: provision Grafana dashboard and deploy kube-state-metrics

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PSHhhez8jcfcQqgd3bC1R5"
```

---

### Task 10: k6 load scenarios as K8s Jobs

**Files:**
- Create: `projects/proactive-sre-agent/k6/normal-load.js`
- Create: `projects/proactive-sre-agent/k6/cpu-stress.js`
- Create: `projects/proactive-sre-agent/k6/db-hold-stress.js`
- Create: `projects/proactive-sre-agent/k8s/60-k6-scripts-configmap.yaml`
- Create: `projects/proactive-sre-agent/k8s/61-k6-job.yaml`
- Create: `projects/proactive-sre-agent/scripts/run-scenario.sh`

**Interfaces:**
- Consumes: `Service/demo-api` from Task 7.
- Produces: a repeatable `run-scenario.sh <scenario>` entrypoint, used by Task 11's
  `measure.py` runs and documented in Task 12's README as the official reproduction steps.

- [ ] **Step 1: Write `normal-load.js`**

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 5,
  duration: '60s',
};

const BASE_URL = __ENV.TARGET_URL || 'http://demo-api.ailab-poc.svc.cluster.local:8080';

export default function () {
  const payload = JSON.stringify({ customerName: 'k6-load', item: 'widget', quantity: 1 });
  const res = http.post(`${BASE_URL}/api/orders`, payload, {
    headers: { 'Content-Type': 'application/json' },
  });
  check(res, { 'status is 201': (r) => r.status === 201 });
  sleep(1);
}
```

- [ ] **Step 2: Write `cpu-stress.js`**

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 5 },
    { duration: '60s', target: 20 },
    { duration: '30s', target: 0 },
  ],
};

const BASE_URL = __ENV.TARGET_URL || 'http://demo-api.ailab-poc.svc.cluster.local:8080';

export default function () {
  const res = http.post(`${BASE_URL}/api/stress/cpu?seconds=5`);
  check(res, { 'status is 202 or 400': (r) => r.status === 202 || r.status === 400 });
  sleep(1);
}
```

- [ ] **Step 3: Write `db-hold-stress.js`**

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '20s', target: 3 },
    { duration: '60s', target: 10 },
    { duration: '20s', target: 0 },
  ],
};

const BASE_URL = __ENV.TARGET_URL || 'http://demo-api.ailab-poc.svc.cluster.local:8080';

export default function () {
  const holdRes = http.post(`${BASE_URL}/api/stress/db-hold?connections=2&seconds=10`);
  check(holdRes, { 'hold accepted or rejected cleanly': (r) => r.status === 202 || r.status === 400 });

  const crudRes = http.get(`${BASE_URL}/api/orders`);
  check(crudRes, { 'crud still responds': (r) => r.status === 200 });

  sleep(1);
}
```

- [ ] **Step 4: Write `60-k6-scripts-configmap.yaml`**

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: k6-scripts
  namespace: ailab-poc
data:
  normal-load.js: |
PLACEHOLDER_NORMAL_LOAD
  cpu-stress.js: |
PLACEHOLDER_CPU_STRESS
  db-hold-stress.js: |
PLACEHOLDER_DB_HOLD_STRESS
```

This file is generated, not hand-maintained — see Step 6's `run-scenario.sh`, which
regenerates it from the three `.js` files (each line indented 4 spaces) before every run,
so the ConfigMap can never drift from the actual script source.

- [ ] **Step 5: Write `61-k6-job.yaml`**

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: k6-run
  namespace: ailab-poc
spec:
  backoffLimit: 0
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: k6
          image: grafana/k6:0.54.0
          command: ["k6", "run", "/scripts/SCENARIO_PLACEHOLDER.js"]
          volumeMounts:
            - name: scripts
              mountPath: /scripts
      volumes:
        - name: scripts
          configMap:
            name: k6-scripts
```

- [ ] **Step 6: Write `run-scenario.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

SCENARIO="${1:-}"
if [[ -z "${SCENARIO}" ]]; then
  echo "Usage: run-scenario.sh <normal-load|cpu-stress|db-hold-stress>"
  exit 1
fi

K6_DIR="projects/proactive-sre-agent/k6"
K8S_DIR="projects/proactive-sre-agent/k8s"
NAMESPACE="ailab-poc"

# Regenerate the ConfigMap from the real .js source files, so it can never drift.
{
  echo "apiVersion: v1"
  echo "kind: ConfigMap"
  echo "metadata:"
  echo "  name: k6-scripts"
  echo "  namespace: ${NAMESPACE}"
  echo "data:"
  for f in normal-load cpu-stress db-hold-stress; do
    echo "  ${f}.js: |"
    sed 's/^/    /' "${K6_DIR}/${f}.js"
  done
} > "${K8S_DIR}/60-k6-scripts-configmap.generated.yaml"

kubectl apply -f "${K8S_DIR}/60-k6-scripts-configmap.generated.yaml"

kubectl -n "${NAMESPACE}" delete job k6-run --ignore-not-found
sed "s/SCENARIO_PLACEHOLDER/${SCENARIO}/" "${K8S_DIR}/61-k6-job.yaml" | kubectl apply -f -

kubectl -n "${NAMESPACE}" wait --for=condition=complete job/k6-run --timeout=180s
kubectl -n "${NAMESPACE}" logs job/k6-run
```

- [ ] **Step 7: Run each scenario and confirm its k6 checks pass**

```bash
chmod +x projects/proactive-sre-agent/scripts/run-scenario.sh
projects/proactive-sre-agent/scripts/run-scenario.sh normal-load
projects/proactive-sre-agent/scripts/run-scenario.sh cpu-stress
projects/proactive-sre-agent/scripts/run-scenario.sh db-hold-stress
```

Expected: each run's logged k6 summary shows `checks.........: 100.00%` (or very close —
occasional `400`s from the Review-Focus validation guards are expected and already
accounted for in each script's `check()`).

- [ ] **Step 8: Commit** (the `.generated.yaml` file is a build artifact, not source — add it
  to `.gitignore` instead of committing it)

```bash
echo "projects/proactive-sre-agent/k8s/60-k6-scripts-configmap.generated.yaml" >> .gitignore
git add projects/proactive-sre-agent/k6 projects/proactive-sre-agent/k8s/60-k6-scripts-configmap.yaml projects/proactive-sre-agent/k8s/61-k6-job.yaml projects/proactive-sre-agent/scripts/run-scenario.sh .gitignore
git commit -m "feat: add k6 load scenarios runnable as reproducible K8s Jobs

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PSHhhez8jcfcQqgd3bC1R5"
```

---

### Task 11: `measure.py` — Prometheus-based lead-time measurement

**Files:**
- Create: `projects/proactive-sre-agent/measure/measure.py`
- Create: `projects/proactive-sre-agent/measure/requirements.txt`
- Test: `projects/proactive-sre-agent/measure/test_measure.py`

**Interfaces:**
- Produces: `query_range(prom_url, query, start, end, step) -> list[tuple[float, float]]`,
  `first_crossing(series, threshold) -> float | None`,
  `compute_lead_time(leading, leading_threshold, lagging, lagging_threshold) -> dict`.
  CLI entrypoint `python measure.py --prom-url ... --leading-query ... --lagging-query ...`.

- [ ] **Step 1: Write `requirements.txt`**

```
requests==2.32.3
pytest==8.3.3
```

- [ ] **Step 2: Write the failing tests in `test_measure.py`**

```python
from unittest.mock import patch, Mock

from measure import query_range, first_crossing, compute_lead_time


def _prometheus_response(pairs: list[tuple[float, float]]) -> dict:
    return {
        "status": "success",
        "data": {
            "result": [
                {"values": [[ts, str(value)] for ts, value in pairs]}
            ]
        },
    }


@patch("measure.requests.get")
def test_query_range_parses_response(mock_get: Mock) -> None:
    mock_get.return_value.json.return_value = _prometheus_response([(1.0, 5.0), (2.0, 7.0)])
    mock_get.return_value.raise_for_status.return_value = None

    series = query_range("http://localhost:9090", "up", 1.0, 2.0, 1.0)

    assert series == [(1.0, 5.0), (2.0, 7.0)]


@patch("measure.requests.get")
def test_query_range_returns_empty_list_when_no_data(mock_get: Mock) -> None:
    mock_get.return_value.json.return_value = {"status": "success", "data": {"result": []}}
    mock_get.return_value.raise_for_status.return_value = None

    series = query_range("http://localhost:9090", "nonexistent_metric", 1.0, 2.0, 1.0)

    assert series == []


def test_first_crossing_detects_threshold() -> None:
    series = [(1.0, 0.0), (2.0, 3.0), (3.0, 10.0)]

    assert first_crossing(series, threshold=5.0) == 3.0


def test_first_crossing_returns_none_when_never_crosses() -> None:
    series = [(1.0, 0.0), (2.0, 1.0)]

    assert first_crossing(series, threshold=5.0) is None


def test_compute_lead_time_positive_when_leading_crosses_before_lagging() -> None:
    leading = [(1.0, 0.0), (2.0, 10.0)]
    lagging = [(1.0, 0.0), (2.0, 0.0), (5.0, 10.0)]

    result = compute_lead_time(leading, 5.0, lagging, 5.0)

    assert result["lead_time_seconds"] == 3.0
    assert result["status"] == "ok"


def test_compute_lead_time_reports_no_data_when_series_empty() -> None:
    result = compute_lead_time([], 5.0, [(1.0, 10.0)], 5.0)

    assert result["status"] == "no_data"
    assert result["lead_time_seconds"] is None


def test_compute_lead_time_reports_never_crossed_when_lagging_never_breaches() -> None:
    leading = [(1.0, 10.0)]
    lagging = [(1.0, 0.0), (2.0, 1.0)]

    result = compute_lead_time(leading, 5.0, lagging, 5.0)

    assert result["status"] == "lagging_never_crossed"
    assert result["lead_time_seconds"] is None
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd projects/proactive-sre-agent/measure && pip install -r requirements.txt && python -I -m pytest test_measure.py -v`
Expected: FAIL — `measure.py` does not exist (`ModuleNotFoundError`).

- [ ] **Step 4: Write `measure.py`**

```python
"""Measures the lead time between a leading indicator and a lagging indicator
crossing their respective thresholds, by querying Prometheus's HTTP API directly."""

import argparse
import json
import sys

import requests


def query_range(
    prom_url: str, query: str, start: float, end: float, step: float
) -> list[tuple[float, float]]:
    """Runs a Prometheus range query and returns (timestamp, value) pairs for the
    first result series, or an empty list if the query matched no series."""
    response = requests.get(
        f"{prom_url}/api/v1/query_range",
        params={"query": query, "start": start, "end": end, "step": step},
        timeout=10,
    )
    response.raise_for_status()
    payload = response.json()
    results = payload.get("data", {}).get("result", [])
    if not results:
        return []
    return [(float(ts), float(value)) for ts, value in results[0]["values"]]


def first_crossing(series: list[tuple[float, float]], threshold: float) -> float | None:
    """Returns the timestamp of the first point where value >= threshold, or None."""
    for timestamp, value in series:
        if value >= threshold:
            return timestamp
    return None


def compute_lead_time(
    leading: list[tuple[float, float]],
    leading_threshold: float,
    lagging: list[tuple[float, float]],
    lagging_threshold: float,
) -> dict:
    """Computes how many seconds before the lagging indicator crossed its threshold
    the leading indicator crossed its own. Distinguishes "no data at all" from
    "data existed but never crossed", since both look like None otherwise."""
    if not leading or not lagging:
        return {"status": "no_data", "lead_time_seconds": None}

    leading_ts = first_crossing(leading, leading_threshold)
    lagging_ts = first_crossing(lagging, lagging_threshold)

    if leading_ts is None:
        return {"status": "leading_never_crossed", "lead_time_seconds": None}
    if lagging_ts is None:
        return {"status": "lagging_never_crossed", "lead_time_seconds": None}

    return {
        "status": "ok",
        "lead_time_seconds": lagging_ts - leading_ts,
        "leading_crossed_at": leading_ts,
        "lagging_crossed_at": lagging_ts,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prom-url", default="http://localhost:9090")
    parser.add_argument("--start", type=float, required=True)
    parser.add_argument("--end", type=float, required=True)
    parser.add_argument("--step", type=float, default=5.0)
    parser.add_argument("--leading-query", required=True)
    parser.add_argument("--leading-threshold", type=float, required=True)
    parser.add_argument("--lagging-query", required=True)
    parser.add_argument("--lagging-threshold", type=float, required=True)
    parser.add_argument("--output", default="measurement-report.json")
    args = parser.parse_args()

    leading = query_range(
        args.prom_url, args.leading_query, args.start, args.end, args.step
    )
    lagging = query_range(
        args.prom_url, args.lagging_query, args.start, args.end, args.step
    )

    result = compute_lead_time(
        leading, args.leading_threshold, lagging, args.lagging_threshold
    )
    result["leading_query"] = args.leading_query
    result["lagging_query"] = args.lagging_query

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)

    print(json.dumps(result, indent=2))
    if result["status"] != "ok":
        sys.exit(1)


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd projects/proactive-sre-agent/measure && python -I -m pytest test_measure.py -v`
Expected: all 7 tests pass.

- [ ] **Step 6: Run it against a live `cpu-stress` scenario for a real measurement**

```bash
kubectl -n ailab-poc port-forward svc/prometheus 9090:9090 &
PF_PID=$!
sleep 3

START=$(date +%s)
projects/proactive-sre-agent/scripts/run-scenario.sh cpu-stress
END=$(date +%s)

cd projects/proactive-sre-agent/measure
python measure.py \
  --prom-url http://localhost:9090 \
  --start "${START}" --end "${END}" --step 5 \
  --leading-query 'stress_active_cpu_tasks{job="demo-api"}' --leading-threshold 1 \
  --lagging-query 'histogram_quantile(0.99, sum(rate(http_server_requests_seconds_bucket{job="demo-api"}[1m])) by (le))' \
  --lagging-threshold 0.5 \
  --output cpu-stress-report.json
cd -
kill "${PF_PID}"
```

Expected: `measurement-report.json`/`cpu-stress-report.json` written with `"status": "ok"`
and a positive `lead_time_seconds` — concrete evidence the leading indicator climbs before
the lagging one does, which is the entire premise Phase 2 depends on.

- [ ] **Step 7: Repeat Step 6 for `db-hold-stress`**, swapping the leading query to
  `hikaricp_connections_pending{job="demo-api"}` with threshold `1`, output to
  `db-hold-stress-report.json`.

- [ ] **Step 8: Commit**

```bash
git add projects/proactive-sre-agent/measure
git commit -m "feat: add Prometheus-based lead-time measurement script

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PSHhhez8jcfcQqgd3bC1R5"
```

---

### Task 12: Top-level README tying the project together

**Files:**
- Create: `projects/proactive-sre-agent/README.md`
- Modify: `C:\Users\ashfa\ai-lab\README.md` (add the `projects/` list entry per the repo's
  own convention)

**Interfaces:**
- None — this is documentation only, consumed by a human reader (and by Phase 2's future
  design doc, which will link back here).

- [ ] **Step 1: Write `projects/proactive-sre-agent/README.md`**

```markdown
# proactive-sre-agent — Phase 1: Observable Base System

Implements Phase 1 of [`designs/proactive-sre-agent`](../../designs/proactive-sre-agent/README.md):
a Spring Boot + Postgres service, instrumented with Prometheus/Grafana, deployed to a local
`kind` cluster with a baseline CPU-based HPA, plus on-demand stress endpoints and a Python
script that measures how early a leading indicator climbs ahead of a lagging one.

## Run it end to end

```bash
projects/proactive-sre-agent/scripts/setup-kind.sh
projects/proactive-sre-agent/scripts/build-and-load.sh

kubectl apply -f projects/proactive-sre-agent/k8s/00-namespace.yaml
kubectl apply -f projects/proactive-sre-agent/k8s/05-postgres-secret.yaml
kubectl apply -f projects/proactive-sre-agent/k8s/10-postgres.yaml
kubectl apply -f projects/proactive-sre-agent/k8s/20-demo-api.yaml
kubectl apply -f projects/proactive-sre-agent/k8s/30-prometheus.yaml
kubectl apply -f projects/proactive-sre-agent/k8s/50-kube-state-metrics.yaml
kubectl apply -f projects/proactive-sre-agent/k8s/40-grafana-secret.yaml
kubectl apply -f projects/proactive-sre-agent/k8s/40-grafana-dashboard.yaml
kubectl apply -f projects/proactive-sre-agent/k8s/40-grafana.yaml

kubectl -n ailab-poc port-forward svc/grafana 3000:3000 &
kubectl -n ailab-poc port-forward svc/prometheus 9090:9090 &

projects/proactive-sre-agent/scripts/run-scenario.sh normal-load
projects/proactive-sre-agent/scripts/run-scenario.sh cpu-stress
projects/proactive-sre-agent/scripts/run-scenario.sh db-hold-stress
```

Grafana: http://localhost:3000 (admin/admin). Prometheus: http://localhost:9090.

## Measuring lead time

```bash
cd projects/proactive-sre-agent/measure
pip install -r requirements.txt
python measure.py --prom-url http://localhost:9090 --start <unix_ts> --end <unix_ts> \
  --leading-query 'stress_active_cpu_tasks{job="demo-api"}' --leading-threshold 1 \
  --lagging-query 'histogram_quantile(0.99, sum(rate(http_server_requests_seconds_bucket{job="demo-api"}[1m])) by (le))' \
  --lagging-threshold 0.5
```

## Measured results

<!-- Filled in after Task 11's live runs; replace with the actual recorded values. -->
- `cpu-stress`: leading indicator (`stress_active_cpu_tasks`) crossed its threshold
  **N seconds** before the lagging indicator (p99 latency) crossed its own.
- `db-hold-stress`: leading indicator (`hikaricp_connections_pending`) crossed its
  threshold **N seconds** before the lagging indicator crossed its own.
- HPA (CPU-based) reacted to `cpu-stress` but, as expected, **did not react** to
  `db-hold-stress` — this is the gap Phase 2's agent needs to close.

## Status

Phase 1 complete. Phase 2 (the MCP-driven agent) is a future design, not yet started.
```

- [ ] **Step 2: Fill in the "Measured results" section with the real numbers from Task 11's
  `cpu-stress-report.json` and `db-hold-stress-report.json`**

- [ ] **Step 3: Update the root `ai-lab/README.md` `projects/` list** — add, after the
  `inframask-extension` bullet:

```markdown
  - [`proactive-sre-agent`](projects/proactive-sre-agent/README.md) — Phase 1 of the
    `proactive-sre-agent` design: an observable Spring Boot + Postgres service with
    on-demand CPU/memory/DB-pool stress endpoints, Prometheus/Grafana, a baseline CPU-based
    HPA, and a Python script that measures how far ahead of failure the leading indicators
    actually climb.
```

- [ ] **Step 4: Commit**

```bash
git add projects/proactive-sre-agent/README.md README.md
git commit -m "docs: add proactive-sre-agent Phase 1 README with measured results

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PSHhhez8jcfcQqgd3bC1R5"
```
