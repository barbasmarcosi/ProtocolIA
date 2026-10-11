package dev.protocolia.generated;
public record Book(
    @jakarta.validation.constraints.NotNull @jakarta.validation.constraints.Size(min=1, max=64) String isbn,
    @jakarta.validation.constraints.NotNull @jakarta.validation.constraints.DecimalMin("0") Integer stock,
    @jakarta.validation.constraints.NotNull @jakarta.validation.constraints.Size(min=1, max=255) String title
) {}
