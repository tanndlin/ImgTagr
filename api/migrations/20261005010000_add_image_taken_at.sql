ALTER TABLE images ADD COLUMN taken_at TIMESTAMPTZ;

CREATE INDEX images_taken_at_idx ON images (COALESCE(taken_at, created_at) DESC);
