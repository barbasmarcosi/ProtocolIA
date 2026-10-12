package dev.protocolia.generated.custom;

import dev.protocolia.generated.Book;
import dev.protocolia.generated.BookRequest;
import dev.protocolia.generated.BookPage;
import dev.protocolia.generated.ContractHandlers;
import dev.protocolia.generated.Health;
import dev.protocolia.generated.StockAdjustment;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
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
    public Book adjustStock(String isbn, StockAdjustment adjustment) {
        if (adjustment == null || adjustment.quantity() == null
                || adjustment.quantity() < 1 || adjustment.quantity() > 1000) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid restock quantity");
        }
        Book updated = books.computeIfPresent(isbn, (key, previous) -> {
            long next = (long) previous.stock() + adjustment.quantity();
            if (next > Integer.MAX_VALUE) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "stock overflow");
            }
            return new Book(previous.isbn(), (int) next, previous.title());
        });
        if (updated == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "book not found");
        }
        return updated;
    }

    @Override
    public BookPage listBooks(Integer limit, Integer offset) {
        if (limit == null || limit < 1 || limit > 50 ||
                offset == null || offset < 0 || offset > 1_000_000) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid page arguments");
        }
        // This is a deliberately bounded, in-memory demonstration.
        // Sort by stable identity; never depend on ConcurrentHashMap iteration order.
        List<Book> ordered = new ArrayList<>(books.values());
        ordered.sort(Comparator.comparing(Book::isbn));
        int total = ordered.size();
        int start = Math.min(offset, total);
        int end = (int) Math.min((long) start + limit, total);
        return new BookPage(List.copyOf(ordered.subList(start, end)), limit, offset, total);
    }

    @Override
    public Health health() {
        return new Health("UP");
    }
}
