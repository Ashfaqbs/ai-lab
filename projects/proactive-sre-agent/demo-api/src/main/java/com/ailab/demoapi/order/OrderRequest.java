package com.ailab.demoapi.order;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record OrderRequest(
        @NotBlank String customerName,
        @NotBlank String item,
        @NotNull @Min(1) Integer quantity) {
}
