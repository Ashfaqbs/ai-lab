package com.ailab.demoapi.order;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
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
    void shouldReturn400WithFieldErrorWhenCustomerNameIsBlank() throws Exception {
        mockMvc.perform(post("/api/orders")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new OrderRequest("", "widget", 1))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fields.customerName").exists());
    }

    @Test
    void shouldReturn400WithFieldErrorWhenCustomerNameExceedsMaxLength() throws Exception {
        String tooLong = "a".repeat(256);

        mockMvc.perform(post("/api/orders")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new OrderRequest(tooLong, "widget", 1))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fields.customerName").exists());
    }

    @Test
    void shouldReturn400WithFieldErrorWhenQuantityIsZero() throws Exception {
        mockMvc.perform(post("/api/orders")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new OrderRequest("Ashfaq", "widget", 0))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fields.quantity").exists());
    }

    @Test
    void shouldReturn400WithFieldErrorWhenQuantityIsNegative() throws Exception {
        mockMvc.perform(post("/api/orders")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new OrderRequest("Ashfaq", "widget", -1))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fields.quantity").exists());
    }

    @Test
    void shouldReturn400WithFieldErrorWhenQuantityIsNull() throws Exception {
        mockMvc.perform(post("/api/orders")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"customerName\":\"Ashfaq\",\"item\":\"widget\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fields.quantity").exists());
    }

    @Test
    void shouldReturn404WhenOrderMissing() throws Exception {
        UUID missing = UUID.randomUUID();
        when(orderService.get(missing)).thenThrow(new OrderNotFoundException(missing));

        mockMvc.perform(get("/api/orders/{id}", missing))
                .andExpect(status().isNotFound());
    }
}
