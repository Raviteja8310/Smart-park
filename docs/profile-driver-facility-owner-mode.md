# SmartPark Driver and Facility Owner Modes

## What the mode switch does

The My profile page lets an active account enable facility-owner capability and then switch the visible workspace between Driver and Facility Owner. The workspace preference is stored per user in that browser. Switching to Driver mode does not remove the `host` role, delete listings, cancel bookings, or change facility status. Server routes continue to make authorization decisions from the user's assigned roles.

## Becoming a facility owner

1. Sign in with an active SmartPark account.
2. Open **My profile** from the avatar or sidebar account control.
3. Choose **Enable facility owner mode**.
4. Select **Facility owner mode** when you want to manage facilities.
5. Choose **Manage facilities & prices** to use the existing `My listings` workflow.
6. Add facility details, spaces, operating availability, photos, and pricing; submit the listing for review.

The self-service endpoint adds `driver` and `host` role rows without removing existing roles. This is capability enablement, not property verification. Listings still pass through the existing review and owner-verification workflows before publication.

## Switching back to Driver

In **My profile**, choose **Driver mode**. This hides owner workspace navigation for convenience while preserving the user's facility-owner capability and data. Open **Find parking**, **Vehicles**, or **My bookings** to use driver features. The mode preference is browser-local and user-specific.

## Parking as a facility owner

A facility owner can also use the ordinary driver reservation flow. Open **Find parking**, choose an available slot from an active, approved facility, select a vehicle registered under **Vehicles**, check the server-calculated quote, and create a reservation hold. This includes an eligible slot at a facility the same user owns if that facility is published and the slot is available. Standard vehicle compatibility, booking overlap, availability, price, and payment rules still apply. Unapproved or draft facilities are not publicly bookable.

## Verification notes

- No database migration is required; this feature reuses the existing `roles`, `user_roles`, `parking_lots`, `parking_slots`, `pricing_rules`, and booking tables.
- Enabling owner capability is auditable through `user.facility_owner_enabled`.
- The active workspace selection is a presentation preference, not a security boundary. Direct API access remains protected by server-side role and ownership checks.
- Before production release, test host-role assignment, own-facility booking, approval status, and payment accounting against a test database/payment environment.
