-- SmartPark Phase 13: physical space details for shared parking listings.
-- Existing listings remain valid; new fields are optional except surface_type's safe default.

ALTER TABLE parking_lots
  ADD COLUMN surface_type ENUM('asphalt','concrete','pavers','gravel','dirt','other') NOT NULL DEFAULT 'other' AFTER parking_type,
  ADD COLUMN space_length_cm SMALLINT UNSIGNED NULL AFTER surface_type,
  ADD COLUMN space_width_cm SMALLINT UNSIGNED NULL AFTER space_length_cm,
  ADD COLUMN max_vehicle_height_cm SMALLINT UNSIGNED NULL AFTER space_width_cm,
  ADD CONSTRAINT chk_lot_space_length CHECK (space_length_cm IS NULL OR space_length_cm BETWEEN 1 AND 3000),
  ADD CONSTRAINT chk_lot_space_width CHECK (space_width_cm IS NULL OR space_width_cm BETWEEN 1 AND 3000),
  ADD CONSTRAINT chk_lot_max_vehicle_height CHECK (max_vehicle_height_cm IS NULL OR max_vehicle_height_cm BETWEEN 1 AND 3000);
