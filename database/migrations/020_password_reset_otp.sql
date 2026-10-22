-- Email OTP password recovery and failed-attempt tracking.
-- Existing one-time password_reset_tokens records are retained; the new counter
-- limits a single code to five verification attempts.
ALTER TABLE password_reset_tokens
  ADD COLUMN attempt_count TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER expires_at;
