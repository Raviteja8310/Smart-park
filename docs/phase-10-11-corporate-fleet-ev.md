# SmartPark combined Phases 10–11: Corporate fleet and EV charging

## Corporate and fleet management

- Authenticated users can create a corporate account with billing contact details.
- The creator is added as a manager. Managers/owners can add existing active SmartPark accounts by email as manager, employee, or driver.
- Corporate members can view their company roster and fleet. Managers/owners can add fleet vehicles, optionally assign them to an existing company member, and mark them active, in maintenance, or retired.
- Fleet registration numbers are normalized to uppercase and unique across the SmartPark fleet registry.
- Actions are recorded in the audit log. This is a company/fleet register, not yet an automated corporate booking allocator or invoicing system.

## EV charging inventory and session records

- Hosts can register chargers against parking facilities they own, including connector type, power, unit rate, connector quantity, notes, and optional hardware provider.
- Drivers can browse available chargers at active, approved facilities and create an operational session record.
- Session end can record energy delivered and calculates an estimate using the per-kWh rate snapshotted when the session started.
- The server enforces session ownership, charger capacity, vehicle ownership, and one active session per driver.

## Important integration boundaries

This release does **not** activate physical charging equipment, retrieve live charger telemetry, meter energy automatically, collect EV charging payments, issue corporate invoices, or allocate employee parking automatically. These require a supported charging-network/OCPP provider, payment integration, and further operational policy. Availability in this UI is the state stored in SmartPark, not verified live hardware status.

## Database migration

Migration `018_corporate_fleet_ev_charging.sql` creates corporate accounts/members/fleet vehicles and EV charger/session tables. Back up the database and verify migration history before running `npm run migrate`. Do not rerun or baseline migrations blindly on a manually managed database.

## Test plan

1. Create a corporate account; verify the creator appears as manager.
2. Add an existing active user as an employee and assign a fleet vehicle to that member.
3. Verify a non-manager cannot add members or fleet vehicles.
4. As a host, add an EV charger to a facility you own.
5. Confirm a driver can start one session only while connector capacity is available.
6. Stop a session with and without energy data; confirm cost is an estimate only and no payment is charged.
7. Verify a user cannot end another driver's session unless they own the facility or are an administrator.
