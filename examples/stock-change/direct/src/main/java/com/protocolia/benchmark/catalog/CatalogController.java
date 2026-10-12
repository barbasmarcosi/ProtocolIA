package com.protocolia.benchmark.catalog;

import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/books")
public class CatalogController {
    private final InMemoryBookRepository books;

    public CatalogController(InMemoryBookRepository books) {
        this.books = books;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Book create(@Valid @RequestBody CreateBookRequest request) {
        return books.insert(request);
    }

    @PatchMapping("/{isbn}/stock")
    public Book adjustStock(@PathVariable String isbn, @Valid @RequestBody StockAdjustment adjustment) {
        return books.restock(isbn, adjustment);
    }

    @GetMapping("/{isbn}")
    public Book get(@PathVariable String isbn) {
        return books.findByIsbn(isbn).orElseThrow(() -> new BookMissingException(isbn));
    }
}
