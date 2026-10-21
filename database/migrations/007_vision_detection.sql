-- SmartPark Phase 7: camera service runtime status and detector configuration.
-- Apply once after migrations 001 through 006. camera_slot_regions.is_active already exists in migration 001.

ALTER TABLE cameras
  ADD COLUMN detector_mode ENUM('yolo') NOT NULL DEFAULT 'yolo' AFTER stream_reference,
  ADD COLUMN confidence_threshold DECIMAL(4,3) NOT NULL DEFAULT 0.250 AFTER detector_mode,
  ADD COLUMN last_frame_at DATETIME(3) NULL AFTER last_seen_at,
  ADD COLUMN last_error VARCHAR(500) NULL AFTER last_frame_at,
  ADD COLUMN stale_after_seconds SMALLINT UNSIGNED NOT NULL DEFAULT 90 AFTER last_error;

ALTER TABLE camera_slot_regions
  ADD INDEX idx_camera_regions_slot_active (slot_id, is_active);
