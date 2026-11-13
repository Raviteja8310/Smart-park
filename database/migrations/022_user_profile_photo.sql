-- Optional profile photo for each user. Additive only: existing rows keep NULL (no photo).
-- Files are stored privately under services/api/uploads/avatars/ and served only to their owner.
ALTER TABLE users
  ADD COLUMN avatar_storage_name VARCHAR(80) NULL AFTER phone,
  ADD COLUMN avatar_updated_at DATETIME NULL AFTER avatar_storage_name;
