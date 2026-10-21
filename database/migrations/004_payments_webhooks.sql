-- SmartPark Phase 5: idempotent payment-provider webhook journal.
-- Apply once after migrations 001 through 003.
CREATE TABLE IF NOT EXISTS payment_webhook_events (
  event_id VARCHAR(180) PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,
  payload_sha256 CHAR(64) NOT NULL,
  processing_status ENUM('received','processed','failed') NOT NULL DEFAULT 'received',
  error_code VARCHAR(80) NULL,
  received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME NULL,
  INDEX idx_payment_webhook_status (processing_status, received_at)
) ENGINE=InnoDB;
