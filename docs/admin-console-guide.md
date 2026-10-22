# SmartPark administrator console

## Access

Administrator navigation is shown only when the signed-in session includes the `admin` role. The API independently enforces this role for user listing, user updates, role assignment, facility status changes, camera configuration, operations and finance review. Hiding a navigation item is not the security boundary.

## Facility and space operations

Open **Parking spaces**. Administrators can create and edit facilities, add zones, generate parking spaces in bulk, manage pricing, change a facility's publication status, and set an individual space to `open`, `disabled`, or `maintenance`. Use **Archive facility** to remove a facility from active offerings without deleting booking/payment history. A facility can be restored from the archived state. Spaces are disabled rather than hard-deleted so bookings and audit references remain intact.

## Camera operations

Open **Camera detection**. Administrators can add a camera source to a facility, configure the detection confidence, map camera-frame regions to parking slots, enable/disable cameras, inspect the last frame/error, and refresh the stream preview. Live detection requires the optional vision service to be running, a valid `VISION_API_TOKEN`, and a source the vision worker can access. Camera configuration alone does not guarantee a real live feed.

## User management

Open **Administration → User management** to search and paginate accounts, inspect roles and email-verification state, edit full name/phone, update account status, and assign roles. Suspending/deleting an account revokes its active sessions. The API prevents an administrator from disabling their own account or removing their own admin role, and prevents demoting the last active administrator. Changes are written to `audit_logs`.

## Administrator profile

Click the profile card in the lower-left sidebar or the avatar in the top bar. Administrators can edit their own name and phone. Email changes, password changes and role changes are separate protected workflows.

## Data and safety

The application stores operational data in MySQL. In local development, Docker runs MySQL and its named volume persists database files. Do not run `docker compose down -v` unless you intend to delete that volume. Facility archive/space disable workflows are preferred to destructive deletes because reservations, payment reconciliation, refunds, and audit history may reference these records.

## Verification

Run `npm run check:syntax` and `npm run test:api`. Run `npm run build` after dependencies are installed on the target OS. The frontend build needs the platform-specific optional Rollup package installed by `npm install`; do not copy `node_modules` from another OS.
