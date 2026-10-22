-- SmartPark Phase 8: referral tracking and auditable non-cash referral credits.
-- Credits are recorded in a ledger; cash payout/redemption is intentionally not implied.
CREATE TABLE IF NOT EXISTS referral_codes (
  user_id CHAR(36) PRIMARY KEY,
  code VARCHAR(16) NOT NULL UNIQUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_referral_codes_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS referrals (
  id CHAR(36) PRIMARY KEY,
  referrer_user_id CHAR(36) NOT NULL,
  referred_user_id CHAR(36) NOT NULL UNIQUE,
  referral_code VARCHAR(16) NOT NULL,
  status ENUM('pending','qualified','rejected') NOT NULL DEFAULT 'pending',
  qualifying_booking_id CHAR(36) NULL UNIQUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  qualified_at DATETIME NULL,
  INDEX idx_referrals_referrer_status (referrer_user_id, status, created_at),
  CONSTRAINT fk_referrals_referrer FOREIGN KEY (referrer_user_id) REFERENCES users(id),
  CONSTRAINT fk_referrals_referred FOREIGN KEY (referred_user_id) REFERENCES users(id),
  CONSTRAINT fk_referrals_booking FOREIGN KEY (qualifying_booking_id) REFERENCES bookings(id),
  CONSTRAINT chk_referrals_not_self CHECK (referrer_user_id <> referred_user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS referral_rewards (
  id CHAR(36) PRIMARY KEY,
  referral_id CHAR(36) NOT NULL,
  beneficiary_user_id CHAR(36) NOT NULL,
  reward_amount DECIMAL(10,2) NOT NULL DEFAULT 100.00,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  status ENUM('available','reversed') NOT NULL DEFAULT 'available',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_referral_reward_beneficiary (referral_id, beneficiary_user_id),
  INDEX idx_referral_rewards_beneficiary (beneficiary_user_id, status, created_at),
  CONSTRAINT fk_referral_rewards_referral FOREIGN KEY (referral_id) REFERENCES referrals(id),
  CONSTRAINT fk_referral_rewards_user FOREIGN KEY (beneficiary_user_id) REFERENCES users(id),
  CONSTRAINT chk_referral_reward_amount CHECK (reward_amount >= 0)
) ENGINE=InnoDB;
