# SmartPark Platform — Comprehensive Project Documentation

Welcome to **SmartPark**, an enterprise-grade, end-to-end intelligent parking and facility management platform built across multiple progressive development phases.

---

## Table of Contents
1. [Overview & Architecture](#overview--architecture)
2. [Project Phasing & Features](#project-phasing--features)
3. [Technology Stack](#technology-stack)
4. [Database Schema & Migrations](#database-schema--migrations)
5. [API Specification & Routes](#api-specification--routes)
6. [Getting Started & Local Development](#getting-started--local-development)
7. [Testing & Quality Assurance](#testing--quality-assurance)

---

## 1. Overview & Architecture
SmartPark is structured as a modern monorepo featuring:
- **`apps/web`**: A responsive, high-performance React + Vite Single Page Application styled with modern CSS and Lucide icons.
- **`services/api`**: A robust Node.js + Express REST API backed by MySQL, implementing secure authentication, granular role-based access control, pricing engines, payment processing, QR gate validation, and peer-to-peer parking sharing.
- **`services/vision`**: Python-based parking detection and computer vision microservice scaffolding.
- **`database/`**: Complete SQL migration scripts and seed utilities.

---

## 2. Project Phasing & Features

### Phase 1: Foundation & Health
- Express backend scaffolding with strict security middleware (`helmet`, `cors`, origin guards, rate limiting).
- Database configuration, connection pooling, and live health check endpoints (`/api/health`).

### Phase 2: Authentication & Role-Based Access Control
- Secure user registration, credential login, password hashing (scrypt with per-user salt), and opaque token authentication.
- Email verification flow, password reset tokens, and granular roles (`driver`, `host`, `operator`, `attendant`, `admin`).

### Phase 3: Parking Inventory & Availability Engine
- Facilities management (draft, pending approval, active, paused).
- Zone organization (floors, levels) and bulk space provisioning.
- Precise availability rules: physical occupancy state vs. reservations, ensuring unknown spaces are never advertised as available.

### Phase 4: Bookings & Dynamic Pricing Engine
- Reservation holds, time-window overlap validation, and auto-expiring holds.
- Flexible pricing rules (hourly, daily, weekly, monthly rates, service fees, and tax calculations).

### Phase 5: Payments, Reconciliation & Gate Access
- Integrated payment processing simulation and Razorpay webhook verification with raw body signature checking.
- Cryptographically signed QR code parking tickets and gate validation endpoints for entry/exit barriers.
- Comprehensive transaction history and automated payment reconciliation.

### Phase 6: P2P Marketplace, Vehicles & Host Earnings
- **Shared Parking Marketplace**: P2P listing of private driveways/spaces with custom weekly availability schedules.
- **Vehicle Garage Management**: Register and manage user vehicles (cars, SUVs, motorcycles) with license plate tracking.
- **Host Earnings & Analytics**: Real-time payout dashboards and financial reporting for space owners and hosts.

---

## 3. Technology Stack
- **Frontend**: React 18, Vite, Lucide React icons.
- **Backend**: Node.js, Express, MySQL (mysql2/promise), Zod validation.
- **Security**: Helmet, CORS origin guard, crypto hashing, HMAC verification.
- **Testing**: Node.js built-in test runner (`node --test`).

---

## 4. Database Schema & Migrations
Migrations are located in `database/migrations/`:
- `001_initial_schema.sql`: Core users, facilities, zones, and parking slots.
- `002_auth_sessions_and_verification.sql`: Authentication sessions, password resets, and role assignments.
- `003_parking_inventory.sql`: Space state tracking and pricing rule tables.
- `004_payments_webhooks.sql`: Payment orders and verified webhook logs.
- `005_payment_reconciliation.sql`: Reconciliation ledger and discrepancy tracking.
- `006_shared_parking_marketplace.sql`: Marketplace shared listings, photos, vehicle garage, and earnings ledger.

---

## 5. API Specification & Routes
- **`/api/auth`**: Registration, login, session validation, password reset, logout.
- **`/api/parking`**: Facilities CRUD, slot inventory, zones, pricing, and live overview.
- **`/api/bookings`**: Quotes, reservation holds, user bookings, and cancellation.
- **`/api/payments`**: Checkout orders, verification, and webhooks.
- **`/api/gate`**: QR ticket generation and physical gate entry/exit validation.
- **`/api/marketplace`**: Shared peer-to-peer parking listings and availability booking.
- **`/api/vehicles`**: User vehicle management.

---

## 6. Getting Started & Local Development

### Prerequisites
- Node.js (v18+)
- MySQL (v8.0+)
- Docker (optional, for running MySQL container)

### Installation & Setup
1. Clone the repository and install workspace dependencies:
   ```bash
   npm install
   ```
2. Configure environment variables in `services/api/.env` (reference `services/api/.env.example`).
3. Run database migrations located in `database/migrations/`.
4. Start development servers (runs both API and Web app concurrently):
   ```bash
   npm run dev
   ```

---

## 7. Testing & Quality Assurance
Run the comprehensive test suite across all implemented modules:
```bash
npm run test:api
```
Build the frontend for production:
```bash
npm run build
```

---
*Generated with [Claude Code](https://claude.com/claude-code)*
