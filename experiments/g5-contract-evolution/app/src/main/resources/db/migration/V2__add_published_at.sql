-- Reviewed additive migration. Existing Books rows remain valid with NULL.
-- Applied ONLY inside disposable PostgreSQL test build.
ALTER TABLE books ADD COLUMN published_at timestamp with time zone NULL;
