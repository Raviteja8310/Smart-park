# SmartPark Phase 7 — Promotion codes

This phase adds admin-managed promotion codes and server-side booking discounts. It extends the existing booking quote and hold flow; it does not introduce a second checkout.

## Included
- Admins can create promotion codes and activate/deactivate them.
- Percentage and fixed discounts, optional maximum discount, minimum parking charge, currency, start/end time, total redemption limit, and per-user limit.
- Drivers can enter a code when requesting a booking quote.
- The API validates the code during quote calculation and revalidates it in the booking transaction.
- The booking snapshot and booking discount amount record the applied discount.
- A redemption is reserved for the 10-minute booking hold, redeemed after verified payment, and released if payment fails. Expired reservations stop counting toward usage limits.
- Administrative changes are written to audit logs.

## API
- `GET /api/promotions` — active public-to-authenticated promotion list.
- `POST /api/promotions/validate` — validates a code against an amount and currency.
- `GET /api/promotions/admin` — admin listing with usage counts.
- `POST /api/promotions/admin` — create a promotion (admin only).
- `PATCH /api/promotions/admin/:promoId` — activate/deactivate a promotion (admin only).
- `POST /api/bookings/quote` and `POST /api/bookings` accept optional `promoCode`.

## Migration
Apply `database/migrations/015_promotions.sql` using the existing migration runner after taking a database backup and checking migration history. Despite the historical filename, this migration currently creates promotion and redemption tables only; referral rewards are not implemented in this phase.

## Important pricing rule
Discounts apply to the parking charge (base amount), not service fees. Tax is recalculated on the discounted base amount plus service fee. The API is authoritative; never trust a client-supplied discount amount.
