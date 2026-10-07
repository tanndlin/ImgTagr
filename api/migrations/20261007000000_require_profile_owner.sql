-- Every row has been claimed by a profile, so ownership is now required.
ALTER TABLE images ALTER COLUMN profile_id SET NOT NULL;
ALTER TABLE tags ALTER COLUMN profile_id SET NOT NULL;
