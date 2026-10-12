package com.protocolia.benchmark.catalog;

public class BookMissingException extends RuntimeException {
    public BookMissingException(String isbn) {
        super("ISBN not found: " + isbn);
    }
}
