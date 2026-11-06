SmartPark
A web-based smart parking platform for drivers, facility owners, operators, and administrators. SmartPark combines parking discovery and reservations with facility management, payment verification, QR-based access, and optional camera-based occupancy detection.
Features
- Parking discovery: Search facilities and shared parking listings by location and availability.
- Reservations and pricing: Server-calculated quotes, time-limited booking holds, and configurable hourly, daily, weekly, or monthly rates.
- Accounts and roles: Secure sessions and role-based access for drivers, hosts, attendants, operators, and administrators.
- Facility management: Manage parking lots, zones, spaces, schedules, pricing, and listing approvals.
- Payments and access: Razorpay integration, payment verification, signed QR tickets, and gate entry/exit workflows.
- Camera occupancy detection: Optional Python service using YOLO to estimate parking-space occupancy.
- Operations tools: Notifications, analytics, alerts, reviews, favorites, support tickets, and financial tracking.
- Additional modules: Corporate fleet management and EV charger/session records.
Tech Stack
- Frontend: React, Vite
- API: Node.js, Express
- Database: MySQL 8
- Vision service: Python, FastAPI, YOLO/Ultralytics
- Deployment: Docker Compose, Nginx, Caddy
Prerequisites
- Node.js 22 or later
- npm
- MySQL 8, or Docker Desktop for the included database setup
- Python 3.11 or 3.12 for the optional vision service
Getting Started
1. Configure environment variables
Copy the example environment file and update the values for your local setup.
Copy-Item .env.example .env
Do not commit .env or production secrets to version control.
2. Install dependencies
npm install
3. Start MySQL
If using the included Docker setup:
npm run db:up
Alternatively, configure .env to connect to a local MySQL 8 instance.
4. Apply database migrations
npm run migrate
Run migrations against the intended database only. Back up existing data and verify migration history before applying changes to an existing database.
5. Start the application
npm run dev
Open the frontend at http://127.0.0.1:5173.

API health check: http://127.0.0.1:4000/api/health.
Local Authentication
1. Register through the web app.
2. In local development without SMTP, check the API terminal for the email-verification link.
3. Open the link and sign in.
For email delivery, configure SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD, and MAIL_FROM in .env.
Optional Camera Detection Service
The vision service requires Python dependencies, a compatible camera or video source, a YOLO model, and calibrated parking-space regions.
cd services/vision
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements-yolo.txt
python -m uvicorn smartpark_vision.main:app --host 127.0.0.1 --port 8000
Configure VISION_API_TOKEN and the other required vision settings in the project environment. See the project documentation for camera setup and deployment details.
Testing and Build
Run the available checks from the project root:
npm run check:syntax
npm run test:api
npm run test:all
npm run build
For live integration checks, start the API and MySQL database, apply migrations, then run:
npm run test:integration
The optional Python vision tests can be run with:
$env:PYTHONPATH = "services/vision"
python -m unittest discover -s services/vision/tests -v
Production Deployment
Production configuration and deployment files are provided in deployment/ and docker-compose.production.yml.

Before deploying:
- Configure a real domain and HTTPS.
- Use strong, unique secrets and production database credentials.
- Configure and test SMTP and Razorpay webhooks using provider sandbox credentials first.
- Back up the database and verify migrations and restore procedures.
- Run the production preflight and validate the Compose configuration.
- Test the complete booking, payment, QR access, email, and camera workflows in staging.
npm run preflight:production
docker compose -f docker-compose.production.yml config --quiet
Important: A successful build or unit-test run does not certify a production deployment. Payment-provider connectivity, database-backed workflows, email delivery, HTTPS, backup restoration, camera accuracy, and gate hardware must be validated in the target environment.
Current Limitations
- Host earnings and payout records do not themselves transfer money; external financial actions may require manual processing.
- Camera occupancy estimates require a suitable model, accessible camera source, calibration, and on-site validation.
- Mock payments are for local development only and must not be used in production.
- Some integrations and workflows require external provider configuration and staging verification.
Documentation
Additional documentation is available in the docs/ directory, including API specifications, deployment and security guidance, operations runbooks, integration testing, and release checklists.
Security
- Never commit .env, API keys, payment secrets, QR-signing secrets, or service tokens.
- Use HTTPS and production-grade credentials in deployed environments.
- Grant roles only to trusted, verified accounts.
- Review the deployment security checklist before releasing.
