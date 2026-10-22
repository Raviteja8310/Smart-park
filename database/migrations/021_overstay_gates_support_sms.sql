-- SmartPark remaining roadmap phases: overstay monitoring, gate-device command queue,
-- support tickets, and opt-in SMS notification delivery. External hardware/providers
-- are only activated when their credentials and adapter are configured.

CREATE TABLE IF NOT EXISTS overstay_incidents (
  id CHAR(36) PRIMARY KEY,
  session_id CHAR(36) NOT NULL,
  booking_id CHAR(36) NOT NULL,
  parking_lot_id CHAR(36) NOT NULL,
  slot_id CHAR(36) NOT NULL,
  status ENUM('active','resolved','manual_review') NOT NULL DEFAULT 'active',
  grace_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 10,
  minutes_overdue INT UNSIGNED NOT NULL DEFAULT 0,
  detected_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_observed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  resolved_at DATETIME(3) NULL,
  resolved_by_user_id CHAR(36) NULL,
  resolution_note VARCHAR(1000) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_overstay_session (session_id),
  INDEX idx_overstay_status (status, last_observed_at),
  INDEX idx_overstay_lot (parking_lot_id, status, detected_at),
  CONSTRAINT fk_overstay_session FOREIGN KEY (session_id) REFERENCES parking_sessions(id),
  CONSTRAINT fk_overstay_booking FOREIGN KEY (booking_id) REFERENCES bookings(id),
  CONSTRAINT fk_overstay_lot FOREIGN KEY (parking_lot_id) REFERENCES parking_lots(id),
  CONSTRAINT fk_overstay_slot FOREIGN KEY (slot_id) REFERENCES parking_slots(id),
  CONSTRAINT fk_overstay_resolver FOREIGN KEY (resolved_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS gate_devices (
  id CHAR(36) PRIMARY KEY,
  parking_lot_id CHAR(36) NOT NULL,
  device_name VARCHAR(120) NOT NULL,
  provider VARCHAR(80) NOT NULL,
  external_device_id VARCHAR(180) NULL,
  device_status ENUM('configured','online','offline','disabled') NOT NULL DEFAULT 'configured',
  supports_entry BOOLEAN NOT NULL DEFAULT TRUE,
  supports_exit BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at DATETIME(3) NULL,
  metadata JSON NULL,
  created_by_user_id CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_gate_device_provider_external (provider, external_device_id),
  INDEX idx_gate_devices_lot_status (parking_lot_id, device_status),
  CONSTRAINT fk_gate_device_lot FOREIGN KEY (parking_lot_id) REFERENCES parking_lots(id),
  CONSTRAINT fk_gate_device_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS gate_device_commands (
  id CHAR(36) PRIMARY KEY,
  gate_device_id CHAR(36) NOT NULL,
  parking_lot_id CHAR(36) NOT NULL,
  requested_by_user_id CHAR(36) NULL,
  command_type ENUM('open','close','status_check') NOT NULL,
  reason VARCHAR(500) NOT NULL,
  status ENUM('queued','dispatched','succeeded','failed','expired','cancelled') NOT NULL DEFAULT 'queued',
  external_reference VARCHAR(180) NULL,
  response_payload JSON NULL,
  failure_message VARCHAR(500) NULL,
  expires_at DATETIME(3) NOT NULL,
  dispatched_at DATETIME(3) NULL,
  completed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_gate_commands_queue (gate_device_id, status, created_at),
  INDEX idx_gate_commands_lot (parking_lot_id, status, created_at),
  CONSTRAINT fk_gate_command_device FOREIGN KEY (gate_device_id) REFERENCES gate_devices(id),
  CONSTRAINT fk_gate_command_lot FOREIGN KEY (parking_lot_id) REFERENCES parking_lots(id),
  CONSTRAINT fk_gate_command_requester FOREIGN KEY (requested_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS support_tickets (
  id CHAR(36) PRIMARY KEY,
  ticket_code VARCHAR(24) NOT NULL UNIQUE,
  user_id CHAR(36) NOT NULL,
  booking_id CHAR(36) NULL,
  parking_lot_id CHAR(36) NULL,
  assigned_to_user_id CHAR(36) NULL,
  category ENUM('booking','payment','entry_exit','facility','safety','account','technical','other') NOT NULL DEFAULT 'other',
  priority ENUM('low','normal','high','urgent') NOT NULL DEFAULT 'normal',
  status ENUM('open','in_progress','waiting_on_user','resolved','closed') NOT NULL DEFAULT 'open',
  subject VARCHAR(160) NOT NULL,
  description TEXT NOT NULL,
  resolution_note VARCHAR(1000) NULL,
  last_activity_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  resolved_at DATETIME(3) NULL,
  closed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_support_user_activity (user_id, last_activity_at),
  INDEX idx_support_queue (status, priority, last_activity_at),
  INDEX idx_support_lot (parking_lot_id, status, last_activity_at),
  CONSTRAINT fk_support_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_support_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL,
  CONSTRAINT fk_support_lot FOREIGN KEY (parking_lot_id) REFERENCES parking_lots(id) ON DELETE SET NULL,
  CONSTRAINT fk_support_assignee FOREIGN KEY (assigned_to_user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS support_ticket_messages (
  id CHAR(36) PRIMARY KEY,
  ticket_id CHAR(36) NOT NULL,
  sender_user_id CHAR(36) NOT NULL,
  message_text TEXT NOT NULL,
  is_internal BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_support_messages_ticket (ticket_id, created_at),
  CONSTRAINT fk_support_message_ticket FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE,
  CONSTRAINT fk_support_message_sender FOREIGN KEY (sender_user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_notification_preferences (
  user_id CHAR(36) PRIMARY KEY,
  sms_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  sms_consent_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_notification_preferences_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

ALTER TABLE notifications
  MODIFY COLUMN delivery_status ENUM('queued','sending','sent','failed','read') NOT NULL DEFAULT 'queued',
  ADD COLUMN delivery_attempt_count TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER delivery_status,
  ADD COLUMN next_attempt_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) AFTER delivery_attempt_count,
  ADD COLUMN delivery_last_error VARCHAR(500) NULL AFTER next_attempt_at,
  ADD COLUMN provider_message_id VARCHAR(255) NULL AFTER delivery_last_error,
  ADD COLUMN delivery_locked_by VARCHAR(120) NULL AFTER provider_message_id,
  ADD COLUMN delivery_locked_until DATETIME(3) NULL AFTER delivery_locked_by,
  ADD INDEX idx_notifications_sms_due (channel, delivery_status, next_attempt_at, created_at);
