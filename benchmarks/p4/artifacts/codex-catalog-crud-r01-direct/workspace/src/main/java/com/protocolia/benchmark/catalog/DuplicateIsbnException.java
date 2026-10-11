package com.protocolia.benchmark.catalog;

public class DuplicateIsbnException extends RuntimeException {
    public DuplicateIsbnException(String isbn) {
        super("ISBN already exists: " + isbn);
    }
}
