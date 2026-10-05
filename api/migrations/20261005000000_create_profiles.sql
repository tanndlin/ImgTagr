CREATE TABLE profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX profiles_name_key ON profiles (lower(name));

CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    profile_id UUID NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);

-- Existing rows stay ownerless until the first profile claims them.
ALTER TABLE images ADD COLUMN profile_id UUID REFERENCES profiles (id) ON DELETE CASCADE;
ALTER TABLE images DROP CONSTRAINT images_sha256_key;
ALTER TABLE images ADD CONSTRAINT images_profile_sha256_key UNIQUE (profile_id, sha256);

ALTER TABLE tags ADD COLUMN profile_id UUID REFERENCES profiles (id) ON DELETE CASCADE;
DROP INDEX tags_name_key;
CREATE UNIQUE INDEX tags_profile_name_key ON tags (profile_id, lower(name));
