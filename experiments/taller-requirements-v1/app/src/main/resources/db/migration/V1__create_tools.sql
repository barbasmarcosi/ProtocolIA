CREATE TABLE tools (
 code varchar(64) PRIMARY KEY,
 name varchar(255) NOT NULL CHECK (length(trim(name))>0),
 quantity integer NOT NULL CHECK (quantity>=0),
 last_reviewed_at timestamptz NULL
);
