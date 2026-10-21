-- SmartPark Phase 12: user discovery preferences and verified parking reviews.
-- Reviews can only be submitted for completed bookings, and one review is allowed per booking.

CREATE TABLE IF NOT EXISTS parking_favorites (
  user_id CHAR(36) NOT NULL,
  parking_lot_id CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, parking_lot_id),
  INDEX idx_parking_favorites_lot (parking_lot_id, created_at),
  CONSTRAINT fk_parking_favorites_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_parking_favorites_lot FOREIGN KEY (parking_lot_id) REFERENCES parking_lots(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS parking_search_history (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  query_text VARCHAR(100) NULL,
  city VARCHAR(100) NULL,
  result_count INT UNSIGNED NULL,
  searched_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_search_history_user_date (user_id, searched_at),
  CONSTRAINT fk_search_history_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS parking_reviews (
  id CHAR(36) PRIMARY KEY,
  parking_lot_id CHAR(36) NOT NULL,
  booking_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  rating TINYINT UNSIGNED NOT NULL,
  review_title VARCHAR(120) NULL,
  review_text VARCHAR(1000) NOT NULL,
  status ENUM('published','hidden') NOT NULL DEFAULT 'published',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_parking_review_booking_user (booking_id, user_id),
  INDEX idx_parking_reviews_lot_status_date (parking_lot_id, status, created_at),
  INDEX idx_parking_reviews_user_date (user_id, created_at),
  CONSTRAINT fk_parking_reviews_lot FOREIGN KEY (parking_lot_id) REFERENCES parking_lots(id) ON DELETE CASCADE,
  CONSTRAINT fk_parking_reviews_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  CONSTRAINT fk_parking_reviews_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_parking_review_rating CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT chk_parking_review_text CHECK (CHAR_LENGTH(TRIM(review_text)) > 0)
) ENGINE=InnoDB;
