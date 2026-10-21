-- Transactional email outbox. Events are inserted in the same DB transaction as the
-- booking/payment/gate change. Delivery is asynchronous and retried by email-worker.js.
CREATE TABLE IF NOT EXISTS transactional_email_outbox (
  id CHAR(36) PRIMARY KEY,
  idempotency_key VARCHAR(190) NOT NULL UNIQUE,
  recipient_user_id CHAR(36) NULL,
  recipient_email VARCHAR(254) NOT NULL,
  template_key VARCHAR(64) NOT NULL,
  template_data JSON NOT NULL,
  status ENUM('queued','sending','sent','simulated','failed') NOT NULL DEFAULT 'queued',
  attempt_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  locked_by VARCHAR(120) NULL,
  locked_until DATETIME(3) NULL,
  provider_message_id VARCHAR(255) NULL,
  last_error VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  sent_at DATETIME(3) NULL,
  processed_at DATETIME(3) NULL,
  INDEX idx_email_outbox_due (status, next_attempt_at, created_at),
  INDEX idx_email_outbox_lease (status, locked_until),
  INDEX idx_email_outbox_user_created (recipient_user_id, created_at),
  CONSTRAINT fk_email_outbox_user FOREIGN KEY (recipient_user_id) REFERENCES users(id),
  CONSTRAINT chk_email_outbox_attempts CHECK (attempt_count <= 8)
) ENGINE=InnoDB;
