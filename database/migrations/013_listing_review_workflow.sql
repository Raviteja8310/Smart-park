-- SmartPark Phase 14: auditable listing moderation decisions and owner-visible feedback.
-- Apply after migrations 001 through 012.

ALTER TABLE parking_lots
  ADD COLUMN review_status ENUM('not_reviewed','pending','approved','rejected') NOT NULL DEFAULT 'not_reviewed' AFTER facility_status,
  ADD COLUMN review_note VARCHAR(1000) NULL AFTER review_status,
  ADD COLUMN reviewed_by_user_id CHAR(36) NULL AFTER review_note,
  ADD COLUMN reviewed_at DATETIME NULL AFTER reviewed_by_user_id,
  ADD INDEX idx_lots_review_queue (listing_kind, review_status, created_at),
  ADD CONSTRAINT fk_lots_reviewed_by FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id);

-- Preserve existing approved facilities as approved; only shared-space listing submissions
-- enter the moderation queue through the submission API.
UPDATE parking_lots SET review_status = 'approved', reviewed_at = updated_at
 WHERE facility_status = 'active' AND listing_kind = 'shared_space';
