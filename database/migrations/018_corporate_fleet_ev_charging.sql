-- SmartPark Phases 10-11: corporate/fleet management and EV charging inventory.
-- Charging sessions are operational records only; charger hardware and billing integrations are separate.
CREATE TABLE IF NOT EXISTS corporate_accounts (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  registration_number VARCHAR(80) NULL,
  billing_email VARCHAR(254) NOT NULL,
  billing_phone VARCHAR(30) NULL,
  billing_address VARCHAR(500) NULL,
  created_by_user_id CHAR(36) NOT NULL,
  status ENUM('active','suspended') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_corporate_creator (created_by_user_id),
  CONSTRAINT fk_corporate_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS corporate_members (
  id CHAR(36) PRIMARY KEY,
  corporate_account_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  member_role ENUM('manager','employee','driver') NOT NULL DEFAULT 'employee',
  status ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_corporate_member (corporate_account_id, user_id),
  INDEX idx_corporate_member_user (user_id, status),
  CONSTRAINT fk_corporate_member_account FOREIGN KEY (corporate_account_id) REFERENCES corporate_accounts(id),
  CONSTRAINT fk_corporate_member_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS corporate_fleet_vehicles (
  id CHAR(36) PRIMARY KEY,
  corporate_account_id CHAR(36) NOT NULL,
  assigned_user_id CHAR(36) NULL,
  registration_number VARCHAR(24) NOT NULL,
  make VARCHAR(80) NULL,
  model VARCHAR(80) NULL,
  vehicle_type ENUM('motorcycle','car','suv','van','truck','other') NOT NULL DEFAULT 'car',
  status ENUM('active','maintenance','retired') NOT NULL DEFAULT 'active',
  created_by_user_id CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_corporate_fleet_registration (registration_number),
  INDEX idx_fleet_account_status (corporate_account_id, status),
  CONSTRAINT fk_fleet_account FOREIGN KEY (corporate_account_id) REFERENCES corporate_accounts(id),
  CONSTRAINT fk_fleet_assignee FOREIGN KEY (assigned_user_id) REFERENCES users(id),
  CONSTRAINT fk_fleet_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ev_chargers (
  id CHAR(36) PRIMARY KEY,
  parking_lot_id CHAR(36) NOT NULL,
  owner_user_id CHAR(36) NOT NULL,
  charger_name VARCHAR(120) NOT NULL,
  connector_type ENUM('type2','ccs2','bharat_ac001','bharat_dc001','chademo','other') NOT NULL DEFAULT 'type2',
  power_kw DECIMAL(7,2) NOT NULL,
  price_per_kwh DECIMAL(10,2) NOT NULL DEFAULT 0,
  quantity SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  availability_status ENUM('available','occupied','maintenance','offline') NOT NULL DEFAULT 'available',
  notes VARCHAR(500) NULL,
  hardware_provider VARCHAR(120) NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_ev_lot_status (parking_lot_id, is_active, availability_status),
  INDEX idx_ev_owner (owner_user_id, created_at),
  CONSTRAINT fk_ev_charger_lot FOREIGN KEY (parking_lot_id) REFERENCES parking_lots(id),
  CONSTRAINT fk_ev_charger_owner FOREIGN KEY (owner_user_id) REFERENCES users(id),
  CONSTRAINT chk_ev_power CHECK (power_kw > 0),
  CONSTRAINT chk_ev_price CHECK (price_per_kwh >= 0),
  CONSTRAINT chk_ev_quantity CHECK (quantity > 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ev_charging_sessions (
  id CHAR(36) PRIMARY KEY,
  charger_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  vehicle_id CHAR(36) NULL,
  status ENUM('active','completed','cancelled') NOT NULL DEFAULT 'active',
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at DATETIME NULL,
  energy_kwh DECIMAL(10,3) NULL,
  price_per_kwh_snapshot DECIMAL(10,2) NOT NULL DEFAULT 0,
  estimated_cost DECIMAL(12,2) NULL,
  notes VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ev_sessions_user (user_id, created_at),
  INDEX idx_ev_sessions_charger_status (charger_id, status),
  CONSTRAINT fk_ev_session_charger FOREIGN KEY (charger_id) REFERENCES ev_chargers(id),
  CONSTRAINT fk_ev_session_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_ev_session_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  CONSTRAINT chk_ev_energy CHECK (energy_kwh IS NULL OR energy_kwh >= 0),
  CONSTRAINT chk_ev_cost CHECK (estimated_cost IS NULL OR estimated_cost >= 0)
) ENGINE=InnoDB;
