package com.protocolia.catalog;

public class BookNotFoundException extends RuntimeException {
    public BookNotFoundException(String isbn) {
        super("No book found for ISBN " + isbn);
    }
}
