package com.protocolia.benchmark.catalog;

import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

import org.springframework.stereotype.Repository;

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

    public Optional<Book> findByIsbn(String isbn) {
        return Optional.ofNullable(byIsbn.get(isbn));
    }
}
