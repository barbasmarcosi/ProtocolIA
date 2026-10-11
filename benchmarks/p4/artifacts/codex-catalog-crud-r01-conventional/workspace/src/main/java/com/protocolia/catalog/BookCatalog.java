package com.protocolia.catalog;

import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

import org.springframework.stereotype.Service;

@Service
public class BookCatalog {
    private final ConcurrentMap<String, Book> books = new ConcurrentHashMap<>();

    public Book create(BookRequest request) {
        Book book = new Book(request.isbn(), request.title(), request.stock());
        if (books.putIfAbsent(book.isbn(), book) != null) {
            throw new DuplicateBookException(book.isbn());
        }
        return book;
    }

    public Optional<Book> find(String isbn) {
        return Optional.ofNullable(books.get(isbn));
    }
}
