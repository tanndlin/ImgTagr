CREATE TABLE images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sha256 TEXT NOT NULL UNIQUE,
    storage_key TEXT NOT NULL,
    thumbnail_key TEXT NOT NULL,
    original_filename TEXT,
    content_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX images_created_at_idx ON images (created_at DESC);
