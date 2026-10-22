-- SmartPark Phase 4: owner verification applications and auditable decisions.
-- Sensitive identity document images and full document numbers are intentionally not stored here.
CREATE TABLE owner_verification_requests (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  legal_name VARCHAR(160) NOT NULL,
  contact_phone VARCHAR(30) NOT NULL,
  property_relationship ENUM('owner','tenant_authorized','manager_authorized','business_representative') NOT NULL,
  document_type ENUM('government_id','business_registration','property_proof','authorization_letter') NOT NULL,
  document_reference_last4 CHAR(4) NULL,
  declaration_accepted BOOLEAN NOT NULL DEFAULT FALSE,
  status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  reviewer_note VARCHAR(1000) NULL,
  reviewed_by_user_id CHAR(36) NULL,
  reviewed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_owner_verification_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_owner_verification_reviewer FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id),
  INDEX idx_owner_verification_status_created (status, created_at),
  INDEX idx_owner_verification_user_created (user_id, created_at)
) ENGINE=InnoDB;
