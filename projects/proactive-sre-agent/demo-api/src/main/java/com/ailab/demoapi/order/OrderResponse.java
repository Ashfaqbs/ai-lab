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
