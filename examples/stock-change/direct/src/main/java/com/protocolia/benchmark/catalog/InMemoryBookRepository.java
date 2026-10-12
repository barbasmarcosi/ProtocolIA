package com.protocolia.benchmark.catalog;

import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

import org.springframework.stereotype.Repository;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

@Repository
public class InMemoryBookRepository {
    private final ConcurrentMap<String, Book> byIsbn = new ConcurrentHashMap<>();

    public Book insert(CreateBookRequest request) {
        Book candidate = new Book(request.isbn(), request.title(), request.stock());
        if (byIsbn.putIfAbsent(candidate.isbn(), candidate) != null) {
            throw new DuplicateIsbnException(candidate.isbn());
        }
        return candidate;
    }

    public Book restock(String isbn, StockAdjustment adjustment) {
        Book updated = byIsbn.computeIfPresent(isbn, (key, book) -> {
            long next = (long) book.stock() + adjustment.quantity();
            if (next > Integer.MAX_VALUE) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "stock overflow");
            }
            return new Book(book.isbn(), book.title(), (int) next);
        });
        if (updated == null) {
            throw new BookMissingException(isbn);
        }
        return updated;
    }

    public Optional<Book> findByIsbn(String isbn) {
        return Optional.ofNullable(byIsbn.get(isbn));
    }
}
