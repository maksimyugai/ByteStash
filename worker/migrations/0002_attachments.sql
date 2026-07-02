-- File attachments stored in R2; this table holds the metadata.
-- r2_key is the object key inside the BUCKET binding.

CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snippet_id INTEGER NOT NULL,
    file_name TEXT NOT NULL,
    mime TEXT NOT NULL DEFAULT 'application/octet-stream',
    size INTEGER NOT NULL DEFAULT 0,
    r2_key TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (snippet_id) REFERENCES snippets (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_attachments_snippet_id ON attachments (snippet_id);
