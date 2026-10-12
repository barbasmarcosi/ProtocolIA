package dev.protocolia.domain;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/** User-owned atomic business rules, independent of generated OpenAPI DTOs. */
@Service
public final class BookInventory {
    public record Entry(String isbn, String title, int stock) {}
    public record Page(List<Entry> items, int limit, int offset, int total) {}

    private final ConcurrentMap<String, Entry> books = new ConcurrentHashMap<>();

    public Entry create(String isbn, String title, Integer stock) {
        if (isbn == null || isbn.isBlank() || title == null || title.isBlank()
                || stock == null || stock < 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid book");
        }
        Entry result = new Entry(isbn, title, stock);
        if (books.putIfAbsent(isbn, result) != null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "duplicate ISBN");
        }
        return result;
    }

    public Entry get(String isbn) {
        Entry found = books.get(isbn);
        if (found == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "book not found");
        return found;
    }

    public Entry restock(String isbn, Integer quantity) {
        if (quantity == null || quantity < 1 || quantity > 1000)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid quantity");
        Entry next = books.computeIfPresent(isbn, (key, current) -> {
            long total = (long) current.stock() + quantity;
            if (total > Integer.MAX_VALUE)
                throw new ResponseStatusException(HttpStatus.CONFLICT, "stock overflow");
            return new Entry(current.isbn(), current.title(), (int) total);
        });
        if (next == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "book not found");
        return next;
    }

    public Page list(Integer limit, Integer offset) {
        if (limit == null || limit < 1 || limit > 50
                || offset == null || offset < 0 || offset > 1_000_000) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid query bounds");
        }
        ArrayList<Entry> values = new ArrayList<>(books.values());
        values.sort(Comparator.comparing(Entry::isbn));
        int start = Math.min(offset, values.size());
        int end = (int) Math.min((long) start + limit, values.size());
        return new Page(List.copyOf(values.subList(start, end)), limit, offset, values.size());
    }
}
