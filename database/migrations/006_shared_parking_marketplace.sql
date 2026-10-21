-- SmartPark Phase 6: shared parking listings, photos, weekly schedules and host earnings.
-- Apply once after migrations 001 through 005.

ALTER TABLE parking_lots
  ADD COLUMN listing_kind ENUM('facility','shared_space') NOT NULL DEFAULT 'facility' AFTER description,
  ADD COLUMN parking_type ENUM('driveway','garage','covered_lot','outdoor_lot','private_bay','commercial','other') NOT NULL DEFAULT 'commercial' AFTER listing_kind,
  ADD COLUMN contact_phone VARCHAR(30) NULL AFTER parking_type,
  ADD COLUMN special_instructions TEXT NULL AFTER contact_phone,
  ADD COLUMN amenities JSON NULL AFTER special_instructions,
  ADD INDEX idx_lots_kind_status_city (listing_kind, facility_status, city);

CREATE TABLE IF NOT EXISTS parking_listing_photos (
  id CHAR(36) PRIMARY KEY,
  parking_lot_id CHAR(36) NOT NULL,
  storage_name VARCHAR(255) NOT NULL UNIQUE,
  public_url VARCHAR(500) NOT NULL,
  alt_text VARCHAR(180) NOT NULL DEFAULT 'Parking space photo',
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  uploaded_by_user_id CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_listing_photos_lot (parking_lot_id, sort_order, created_at),
  CONSTRAINT fk_listing_photos_lot FOREIGN KEY (parking_lot_id) REFERENCES parking_lots(id) ON DELETE CASCADE,
  CONSTRAINT fk_listing_photos_user FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS parking_availability_rules (
  id CHAR(36) PRIMARY KEY,
  parking_lot_id CHAR(36) NOT NULL,
  weekday TINYINT UNSIGNED NOT NULL COMMENT '0=Sunday, 6=Saturday',
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  opens_at TIME NULL,
  closes_at TIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_listing_availability_day (parking_lot_id, weekday),
  CONSTRAINT chk_listing_weekday CHECK (weekday BETWEEN 0 AND 6),
  CONSTRAINT chk_listing_availability_hours CHECK (is_available = FALSE OR (opens_at IS NOT NULL AND closes_at IS NOT NULL AND closes_at > opens_at)),
  CONSTRAINT fk_listing_availability_lot FOREIGN KEY (parking_lot_id) REFERENCES parking_lots(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS host_earnings (
  id CHAR(36) PRIMARY KEY,
  booking_id CHAR(36) NOT NULL UNIQUE,
  payment_id CHAR(36) NOT NULL UNIQUE,
  owner_user_id CHAR(36) NOT NULL,
  parking_lot_id CHAR(36) NOT NULL,
  gross_amount DECIMAL(12,2) NOT NULL,
  discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  platform_fee_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  net_amount DECIMAL(12,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  status ENUM('pending','approved','paid','reversed') NOT NULL DEFAULT 'pending',
  settlement_reference VARCHAR(180) NULL,
  settled_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_host_earnings_owner_status (owner_user_id, status, created_at),
  CONSTRAINT fk_host_earnings_booking FOREIGN KEY (booking_id) REFERENCES bookings(id),
  CONSTRAINT fk_host_earnings_payment FOREIGN KEY (payment_id) REFERENCES payments(id),
  CONSTRAINT fk_host_earnings_owner FOREIGN KEY (owner_user_id) REFERENCES users(id),
  CONSTRAINT fk_host_earnings_lot FOREIGN KEY (parking_lot_id) REFERENCES parking_lots(id),
  CONSTRAINT chk_host_earnings_amounts CHECK (gross_amount >= 0 AND discount_amount >= 0 AND platform_fee_amount >= 0 AND net_amount >= 0)
) ENGINE=InnoDB;

-- Host listings created in Phase 6 seed all seven weekly rows. Existing facilities remain
-- unchanged and continue using their current opening_time / closing_time fields.
