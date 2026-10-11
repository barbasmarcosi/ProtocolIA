package com.protocolia.benchmark.catalog;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record CreateBookRequest(
        @NotBlank String isbn,
        @NotBlank String title,
        @NotNull @Min(0) Integer stock
) {
}
