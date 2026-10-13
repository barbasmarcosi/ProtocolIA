package dev.protocolia.domain;

import java.util.List;
import java.time.OffsetDateTime;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** User-owned SQL, PostgreSQL-backed domain; no HTTP-to-SQL synthesis. */
@Service
public class BookInventory {
    public record Entry(String isbn, String title, int stock, OffsetDateTime publishedAt) {}
    public record Page(List<Entry> items, int limit, int offset, int total) {}

    private final JdbcTemplate jdbc;
    public BookInventory(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    private static final org.springframework.jdbc.core.RowMapper<Entry> ROW =
        (rs, index) -> new Entry(rs.getString("isbn"), rs.getString("title"),
            rs.getInt("stock"), rs.getObject("published_at", OffsetDateTime.class));

    public Entry create(String isbn, String title, Integer stock) {
        return create(isbn, title, stock, null);
    }

    @Transactional
    public Entry create(String isbn, String title, Integer stock, OffsetDateTime publishedAt) {
        if (isbn == null || isbn.isBlank() || title == null || title.isBlank()
                || stock == null || stock < 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid book");
        }
        try {
            jdbc.update("INSERT INTO books(isbn, title, stock, published_at) VALUES (?, ?, ?, ?)",
                isbn, title, stock, publishedAt);
        } catch (DuplicateKeyException duplicate) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "duplicate ISBN", duplicate);
        }
        return new Entry(isbn, title, stock, publishedAt);
    }

    @Transactional(readOnly = true)
    public Entry get(String isbn) {
        List<Entry> rows = jdbc.query("SELECT isbn, title, stock, published_at FROM books WHERE isbn = ?", ROW, isbn);
        if (rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "book not found");
        return rows.get(0);
    }

    @Transactional
    public Entry restock(String isbn, Integer quantity) {
        if (quantity == null || quantity < 1 || quantity > 1000)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid quantity");
        // A single row-locked UPDATE safely serializes concurrent increments.
        // The second predicate prevents 32-bit integer overflow, returning 409.
        int changed = jdbc.update(
            "UPDATE books SET stock = stock + ? WHERE isbn = ? AND stock <= ?",
            quantity, isbn, Integer.MAX_VALUE - quantity);
        if (changed == 0) {
            if (jdbc.query("SELECT isbn FROM books WHERE isbn = ?",
                    (rs, i) -> rs.getString(1), isbn).isEmpty()) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, "book not found");
            }
            throw new ResponseStatusException(HttpStatus.CONFLICT, "stock overflow");
        }
        return get(isbn);
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Page list(Integer limit, Integer offset) {
        if (limit == null || limit < 1 || limit > 50 ||
                offset == null || offset < 0 || offset > 1_000_000) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid query bounds");
        }
        // Count and page use the same PostgreSQL repeatable-read snapshot.
        Long count = jdbc.queryForObject("SELECT COUNT(*) FROM books", Long.class);
        int total = Math.toIntExact(count == null ? 0L : count);
        List<Entry> items = jdbc.query(
            "SELECT isbn, title, stock, published_at FROM books ORDER BY isbn LIMIT ? OFFSET ?",
            ROW, limit, offset);
        return new Page(List.copyOf(items), limit, offset, total);
    }
}
