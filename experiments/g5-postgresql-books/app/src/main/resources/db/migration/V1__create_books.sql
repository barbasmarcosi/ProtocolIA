-- Reviewed, user-owned PostgreSQL migration. Never inferred from HTTP paths.
CREATE TABLE books (
    isbn text PRIMARY KEY,
    title text NOT NULL,
    stock integer NOT NULL DEFAULT 0,
    CONSTRAINT books_isbn_not_blank CHECK (length(btrim(isbn)) > 0),
    CONSTRAINT books_title_not_blank CHECK (length(btrim(title)) > 0),
    CONSTRAINT books_stock_nonnegative CHECK (stock >= 0)
);
