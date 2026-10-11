package com.protocolia.catalog;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record BookRequest(
        @NotBlank String isbn,
        @NotBlank String title,
        @NotNull @Min(0) Integer stock
) {
}
