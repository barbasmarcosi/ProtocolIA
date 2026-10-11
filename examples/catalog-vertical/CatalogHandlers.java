package dev.protocolia.generated.custom;

import dev.protocolia.generated.Book;
import dev.protocolia.generated.BookRequest;
import dev.protocolia.generated.ContractHandlers;
import dev.protocolia.generated.Health;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/** Handwritten business logic, separate from generated HTTP and security adapter. */
@Service
public final class CatalogHandlers implements ContractHandlers {
    private final ConcurrentMap<String, Book> books = new ConcurrentHashMap<>();

    @Override
    public Book createBook(BookRequest input) {
        if (input == null || input.isbn() == null || input.isbn().isBlank()
                || input.title() == null || input.title().isBlank()
                || input.stock() == null || input.stock() < 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid book");
        }
        Book book = new Book(input.isbn(), input.stock(), input.title());
        if (books.putIfAbsent(book.isbn(), book) != null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "duplicate ISBN");
        }
        return book;
    }

    @Override
    public Book getBook(String isbn) {
        Book found = books.get(isbn);
        if (found == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "book not found");
        }
        return found;
    }

    @Override
    public Health health() {
        return new Health("UP");
    }
}
