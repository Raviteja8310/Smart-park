# SmartPark Platform — Comprehensive Master Documentation

Welcome to **SmartPark**, an original, web-first smart-parking platform combining facility inventory, shared parking listings, bookings, payment verification, QR access, operator workflows, camera-based occupancy detection, operations analytics, transactional email delivery, and financial controls across 11 progressive development phases.

---

## Table of Contents
1. [Overview & Architecture](#overview--architecture)
2. [Project Phasing & Features](#project-phasing--features)
3. [Database Schema & Migrations](#database-schema--migrations)
4. [Getting Started & Local Development](#getting-started--local-development)
5. [Authentication & Role Assignment](#authentication--role-assignment)
6. [Testing & Quality Assurance](#testing--quality-assurance)

---

## 1. Overview & Architecture
SmartPark is structured as a modern monorepo featuring:
- **`apps/web`**: A responsive React + Vite Single Page Application styled with modern CSS and Lucide icons.
- **`services/api`**: A robust Node.js + Express REST API backed by MySQL, implementing secure authentication, granular RBAC, pricing engines, payment processing, QR gate validation, P2P parking sharing, analytics, transactional email outbox, and financial controls.
- **`services/vision`**: Python-based FastAPI parking detection and computer vision microservice using YOLO/Ultralytics.
- **`database/`**: Complete SQL migration scripts (`001` through `010`).
- **`deployment/` & `docs/`**: Production containerization assets (Dockerfiles, Nginx, Caddy, Compose) and operations runbooks.

---

## 2. Project Phasing & Features

### Phase 1: Foundation & Health
- Express backend scaffolding with strict security middleware (`helmet`, `cors`, origin guards, rate limiting).
- Database configuration, connection pooling, and live health check endpoints (`/api/health`).

### Phase 2: Authentication & Role-Based Access Control
- Secure user registration, credential login, password hashing (`scrypt` with per-user salt), and opaque token authentication.
- Email verification flow, password reset links, and granular roles (`driver`, `host`, `operator`, `attendant`, `admin`).

### Phase 3: Parking Inventory & Availability Engine
- Facilities management (draft, pending approval, active, paused).
- Zone organization and bulk space provisioning.
- Precise availability rules: physical occupancy state vs. reservations, ensuring unknown spaces are never advertised as available.

### Phase 4: Bookings & Dynamic Pricing Engine
- Server-calculated booking quotes using active hourly, daily, weekly or monthly pricing rules.
- 10-minute temporary reservation holds with overlap validation and automatic expiry.

### Phase 5: Payments, Reconciliation & Gate Access
- Razorpay checkout integration with secure raw-body webhook signature verification.
- Cryptographically signed QR code parking tickets and gate validation endpoints for entry/exit barriers.
- Transaction history and payment reconciliation logging.

### Phase 6: P2P Marketplace, Vehicles & Host Earnings
- **Shared Parking Marketplace**: P2P listing of private driveways/spaces with custom weekly availability schedules and photo uploads.
- **Vehicle Garage Management**: Register and manage user vehicles with license plate tracking.
- **Host Earnings**: Real-time payout dashboards and financial reporting for space owners and hosts.

### Phase 7: Camera-Based Occupancy Detection
- Separate Python FastAPI vision service (`services/vision/`) running YOLO/Ultralytics vehicle detection.
- Operator-configured normalized slot polygons, multi-frame occupancy stabilization, and secure heartbeat communication.

### Phase 8: Operations Analytics, Alerts and Notifications
- Dedicated **Operations** workspace for hosts, operators, and admins with live inventory, occupancy metrics, revenue reporting, and camera/payment alert resolution.
- In-app notification inbox.

### Phase 9: Release Hardening & Deployment
- Production configuration validation (`preflight-production.mjs`), migration runner (`migrate.js`), Caddy/Nginx reverse proxy setups, and containerized deployment configs.

### Phase 10: Transactional Email Delivery
- Database-backed transactional outbox pattern (`email-outbox.js`, `transactional-email.js`) ensuring notifications and business logic share database transactions and roll back safely.
- Background retry worker supporting row-level locking (`SKIP LOCKED`), exponential backoff up to 8 attempts, and terminal failure handling.

### Phase 11: Refunds, Host Payouts & Financial Controls
- Audited customer refund requests for eligible upcoming confirmed bookings and manual host-payout request processing.

---

## 3. Database Schema & Migrations
Migrations are located in `database/migrations/`:
- `001_initial_schema.sql`: Core users, facilities, zones, and parking slots.
- `002_auth_sessions_and_verification.sql`: Authentication sessions, password resets, and role assignments.
- `003_parking_inventory.sql`: Space state tracking and pricing rule tables.
- `004_payments_webhooks.sql`: Payment orders and verified webhook logs.
- `005_payment_reconciliation.sql`: Reconciliation ledger and discrepancy tracking.
- `006_shared_parking_marketplace.sql`: Marketplace shared listings, photos, vehicle garage, and earnings ledger.
- `007_vision_detection.sql`: Camera configuration, heartbeat timestamps, and region mappings.
- `008_operations_analytics_alerts.sql`: Operational alerts and analytics indexes.
- `009_transactional_email_outbox.sql`: Transactional email outbox queue.
- `010_refunds_and_host_payouts.sql`: Refund requests, payout requests, and financial audit tables.

---

## 4. Getting Started & Local Development

### Prerequisites
- Node.js 22+ recommended.
- npm.
- Docker Desktop (optional, for MySQL container) or local MySQL 8.
- Python 3.11/3.12 (optional, for the vision service).

### Windows PowerShell Setup
1. Copy the environment template:
   ```powershell
   Copy-Item .env.example .env
   ```
2. Install workspace dependencies:
   ```powershell
   npm install
   ```
3. Start MySQL using Docker:
   ```powershell
   npm run db:up
   ```
4. Run schema migrations automatically:
   ```powershell
   npm run migrate
   ```
5. Start the web app and API:
   ```powershell
   npm run dev
   ```
6. Open `http://127.0.0.1:5173`. API health check: `http://127.0.0.1:4000/api/health`.

---

## 5. Authentication & Role Assignment
- Register a driver account on the web sign-in screen.
- In local development, the API terminal prints a one-time verification link.
- Assign roles via the CLI:
  ```powershell
  npm run role:grant --workspace @smartpark/api -- user@example.com admin
  npm run role:grant --workspace @smartpark/api -- host@example.com host
  ```
  Supported roles: `driver`, `host`, `attendant`, `operator`, `admin`.

---

## 6. Testing & Quality Assurance
Run the complete test suite across all implemented modules (64+ tests):
```powershell
npm run test:api
```
Build the frontend for production:
```powershell
npm run build
```

---
*Generated with [Claude Code](https://claude.com/claude-code)*
