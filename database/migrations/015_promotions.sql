-- SmartPark Phase 15: promotion codes and auditable booking redemptions.
CREATE TABLE IF NOT EXISTS promo_codes (
  id CHAR(36) PRIMARY KEY,
  code VARCHAR(32) NOT NULL UNIQUE,
  description VARCHAR(240) NOT NULL DEFAULT '',
  discount_type ENUM('percent','fixed') NOT NULL,
  discount_value DECIMAL(12,2) NOT NULL,
  max_discount_amount DECIMAL(12,2) NULL,
  min_booking_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  max_redemptions INT UNSIGNED NULL,
  max_redemptions_per_user INT UNSIGNED NOT NULL DEFAULT 1,
  starts_at DATETIME NULL,
  ends_at DATETIME NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_promo_active_window (is_active, starts_at, ends_at),
  CONSTRAINT fk_promo_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT chk_promo_value CHECK (discount_value > 0),
  CONSTRAINT chk_promo_minimum CHECK (min_booking_amount >= 0),
  CONSTRAINT chk_promo_percent CHECK (discount_type <> 'percent' OR discount_value <= 100)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS promo_redemptions (
  id CHAR(36) PRIMARY KEY,
  promo_code_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  booking_id CHAR(36) NOT NULL UNIQUE,
  discount_amount DECIMAL(12,2) NOT NULL,
  status ENUM('reserved','redeemed','released') NOT NULL DEFAULT 'reserved',
  expires_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  redeemed_at DATETIME NULL,
  INDEX idx_promo_redemption_usage (promo_code_id, status, expires_at),
  INDEX idx_promo_redemption_user (promo_code_id, user_id, status),
  CONSTRAINT fk_promo_redemption_code FOREIGN KEY (promo_code_id) REFERENCES promo_codes(id),
  CONSTRAINT fk_promo_redemption_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_promo_redemption_booking FOREIGN KEY (booking_id) REFERENCES bookings(id),
  CONSTRAINT chk_promo_redemption_amount CHECK (discount_amount >= 0)
) ENGINE=InnoDB;
