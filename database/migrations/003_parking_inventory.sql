-- SmartPark Phase 3: physical state, lot staff assignments and inventory indexes.
-- Apply once after migrations 001 and 002.

ALTER TABLE parking_slots
  ADD COLUMN physical_state ENUM('empty','occupied','unknown') NOT NULL DEFAULT 'unknown' AFTER operational_status,
  ADD COLUMN physical_state_updated_at DATETIME(3) NULL AFTER physical_state,
  ADD COLUMN notes VARCHAR(500) NULL AFTER physical_state_updated_at,
  ADD INDEX idx_slots_physical_state (parking_lot_id, operational_status, physical_state);

CREATE TABLE IF NOT EXISTS parking_lot_staff (
  id CHAR(36) PRIMARY KEY,
  parking_lot_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  assignment_role ENUM('operator','attendant') NOT NULL,
  assigned_by_user_id CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_lot_staff_role (parking_lot_id, user_id, assignment_role),
  INDEX idx_lot_staff_user (user_id, assignment_role),
  CONSTRAINT fk_lot_staff_lot FOREIGN KEY (parking_lot_id) REFERENCES parking_lots(id),
  CONSTRAINT fk_lot_staff_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_lot_staff_assigner FOREIGN KEY (assigned_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB;
