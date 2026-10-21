-- SmartPark Phase 5.1: persist captured-payment reconciliation flags for retry-safe responses.
-- Apply once after migration 004.
ALTER TABLE payments
  ADD COLUMN needs_reconciliation BOOLEAN NOT NULL DEFAULT FALSE AFTER status,
  ADD INDEX idx_payments_reconciliation (needs_reconciliation, updated_at);
