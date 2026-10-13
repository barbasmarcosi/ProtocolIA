package dev.protocolia.domain;

import java.util.List;
import org.springframework.stereotype.Service;
import dev.protocolia.upstream.api.BooksApiDelegate;
import dev.protocolia.upstream.model.Book;
import dev.protocolia.upstream.model.BookPage;
import dev.protocolia.upstream.model.BookRequest;
import dev.protocolia.upstream.model.StockAdjustment;

/** Handwritten adapter implements ONLY generated delegate interfaces. */
@Service
public final class BooksDelegate implements BooksApiDelegate {
    private final BookInventory inventory;
    public BooksDelegate(BookInventory inventory) { this.inventory = inventory; }

    private static Book toWire(BookInventory.Entry b) {
        return new Book().isbn(b.isbn()).title(b.title()).stock(b.stock())
            .publishedAt(b.publishedAt());
    }

    @Override
    public Book createBook(BookRequest request) {
        if (request == null) return toWire(inventory.create(null, null, null));
        return toWire(inventory.create(request.getIsbn(), request.getTitle(), request.getStock(),
            request.getPublishedAt()));
    }

    @Override
    public Book getBook(String isbn) { return toWire(inventory.get(isbn)); }

    @Override
    public Book adjustStock(String isbn, StockAdjustment adjustment) {
        return toWire(inventory.restock(isbn, adjustment == null ? null : adjustment.getQuantity()));
    }

    @Override
    public BookPage listBooks(Integer limit, Integer offset) {
        BookInventory.Page page = inventory.list(limit, offset);
        List<Book> items = page.items().stream().map(BooksDelegate::toWire).toList();
        return new BookPage().items(items).limit(page.limit())
            .offset(page.offset()).total(page.total());
    }
}
