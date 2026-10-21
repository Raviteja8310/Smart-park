-- SmartPark Phase 8: operational alerts and analytics support.
-- Apply once after migrations 001 through 007.

CREATE TABLE IF NOT EXISTS operational_alerts (
  id CHAR(36) PRIMARY KEY,
  fingerprint VARCHAR(190) NOT NULL UNIQUE,
  parking_lot_id CHAR(36) NULL,
  source_type ENUM('camera','payment','booking','inventory','system') NOT NULL,
  source_id VARCHAR(80) NULL,
  alert_type VARCHAR(80) NOT NULL,
  severity ENUM('info','warning','critical') NOT NULL DEFAULT 'warning',
  title VARCHAR(160) NOT NULL,
  message VARCHAR(1000) NOT NULL,
  status ENUM('open','acknowledged','resolved') NOT NULL DEFAULT 'open',
  condition_active BOOLEAN NOT NULL DEFAULT TRUE,
  first_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  acknowledged_by_user_id CHAR(36) NULL,
  acknowledged_at DATETIME NULL,
  resolved_by_user_id CHAR(36) NULL,
  resolved_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_operational_alerts_status (status, severity, last_seen_at),
  INDEX idx_operational_alerts_lot (parking_lot_id, status, last_seen_at),
  INDEX idx_operational_alerts_source (source_type, source_id, status),
  CONSTRAINT fk_alerts_lot FOREIGN KEY (parking_lot_id) REFERENCES parking_lots(id) ON DELETE SET NULL,
  CONSTRAINT fk_alerts_ack_user FOREIGN KEY (acknowledged_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_alerts_resolve_user FOREIGN KEY (resolved_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

ALTER TABLE notifications
  ADD INDEX idx_notifications_user_created (user_id, created_at),
  ADD INDEX idx_notifications_user_unread (user_id, delivery_status, read_at);

ALTER TABLE payments
  ADD INDEX idx_payments_status_verified (status, verified_at, needs_reconciliation);

ALTER TABLE bookings
  ADD INDEX idx_bookings_created_status (created_at, status),
  ADD INDEX idx_bookings_lot_interval (parking_lot_id, start_at, end_at, status);
