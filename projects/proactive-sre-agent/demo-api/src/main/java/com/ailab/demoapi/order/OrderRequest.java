package com.ailab.demoapi.order;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record OrderRequest(
        @NotBlank @Size(max = 255) String customerName,
        @NotBlank @Size(max = 255) String item,
        @NotNull @Min(1) Integer quantity) {
}
