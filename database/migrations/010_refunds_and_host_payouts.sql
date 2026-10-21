-- SmartPark Phase 11: audited customer refund requests and host payout workflow.
-- Payouts are recorded after an external bank/provider transfer; this migration does not initiate bank transfers.

ALTER TABLE host_earnings
  MODIFY COLUMN status ENUM('pending','approved','payout_requested','refund_hold','paid','reversed') NOT NULL DEFAULT 'pending';

CREATE TABLE IF NOT EXISTS refund_requests (
  id CHAR(36) PRIMARY KEY,
  payment_id CHAR(36) NOT NULL,
  booking_id CHAR(36) NOT NULL,
  requested_by_user_id CHAR(36) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  status ENUM('requested','approved','processing','succeeded','rejected','failed','manual_review') NOT NULL DEFAULT 'requested',
  owner_earning_id CHAR(36) NULL,
  owner_earning_previous_status ENUM('pending','approved') NULL,
  provider_refund_reference VARCHAR(180) NULL,
  admin_note VARCHAR(1000) NULL,
  reviewed_by_user_id CHAR(36) NULL,
  requested_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  reviewed_at DATETIME(3) NULL,
  processed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_refund_provider_reference (provider_refund_reference),
  INDEX idx_refunds_queue (status, requested_at),
  INDEX idx_refunds_user (requested_by_user_id, requested_at),
  INDEX idx_refunds_payment_status (payment_id, status),
  CONSTRAINT fk_refunds_payment FOREIGN KEY (payment_id) REFERENCES payments(id),
  CONSTRAINT fk_refunds_booking FOREIGN KEY (booking_id) REFERENCES bookings(id),
  CONSTRAINT fk_refunds_requester FOREIGN KEY (requested_by_user_id) REFERENCES users(id),
  CONSTRAINT fk_refunds_reviewed_by FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id),
  CONSTRAINT fk_refunds_earning FOREIGN KEY (owner_earning_id) REFERENCES host_earnings(id),
  CONSTRAINT chk_refund_amount CHECK (amount > 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS host_payout_requests (
  id CHAR(36) PRIMARY KEY,
  owner_user_id CHAR(36) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  status ENUM('requested','approved','paid','rejected','failed','manual_review') NOT NULL DEFAULT 'requested',
  owner_note VARCHAR(500) NULL,
  admin_note VARCHAR(1000) NULL,
  external_reference VARCHAR(180) NULL,
  reviewed_by_user_id CHAR(36) NULL,
  paid_by_user_id CHAR(36) NULL,
  requested_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  reviewed_at DATETIME(3) NULL,
  paid_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_host_payout_external_reference (external_reference),
  INDEX idx_host_payout_owner_status (owner_user_id, status, requested_at),
  INDEX idx_host_payout_queue (status, requested_at),
  CONSTRAINT fk_host_payout_owner FOREIGN KEY (owner_user_id) REFERENCES users(id),
  CONSTRAINT fk_host_payout_reviewed_by FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id),
  CONSTRAINT fk_host_payout_paid_by FOREIGN KEY (paid_by_user_id) REFERENCES users(id),
  CONSTRAINT chk_host_payout_amount CHECK (amount > 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS host_payout_allocations (
  id CHAR(36) PRIMARY KEY,
  payout_request_id CHAR(36) NOT NULL,
  host_earning_id CHAR(36) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  currency CHAR(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_payout_earning (payout_request_id, host_earning_id),
  INDEX idx_payout_allocation_earning (host_earning_id),
  CONSTRAINT fk_payout_alloc_request FOREIGN KEY (payout_request_id) REFERENCES host_payout_requests(id),
  CONSTRAINT fk_payout_alloc_earning FOREIGN KEY (host_earning_id) REFERENCES host_earnings(id),
  CONSTRAINT chk_payout_allocation_amount CHECK (amount > 0)
) ENGINE=InnoDB;
