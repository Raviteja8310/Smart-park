# SmartPark saved parking and reviews (Phase 12)

## Favorites

- `GET /api/engagement/favorites/ids` returns active facility IDs saved by the current account.
- `GET /api/engagement/favorites` returns saved active facility cards for the current account.
- `POST /api/engagement/favorites/:lotId` saves an active facility. Repeating the request is safe.
- `DELETE /api/engagement/favorites/:lotId` removes the favorite.
- Favorites are private per user. The API does not expose one user's saved places to another account.

## Recent searches

- `POST /api/engagement/search-history` accepts only `q` and `city`, normalizes whitespace and truncates each field to 100 characters. Empty searches are ignored. GPS coordinates are not accepted or stored.
- `GET /api/engagement/search-history?limit=20` returns only the current user's records.
- `DELETE /api/engagement/search-history/:searchId` removes one record owned by the current user; `DELETE /api/engagement/search-history` clears the user's history.
- When an account has at least 500 retained searches, older records are pruned before another record is added.

## Reviews and ratings

- The review form is available only for a completed booking associated with that parking facility and current account.
- One review per completed booking is enforced in the application and by unique database constraint `uq_parking_review_booking_user`.
- Facility owners cannot review their own facility. Review rating is an integer 1–5; title is optional up to 120 characters; text is 3–1000 characters.
- Public review listing is limited to active facilities and published reviews. Average ratings/counts exclude hidden reviews.
- Public review records return a shortened display name (first name and last initial) and do not expose booking IDs, email addresses or full names.
- Users can edit/delete their own reviews. Admins can hide or republish reviews; moderation changes create an audit event.

## Migration and checks

Migration: `database/migrations/011_favorites_search_reviews.sql`.

Run `npm run migrate` after confirming the migration history is correct. Do not replay numbered migrations that have already succeeded. For a manually migrated database without history, back up and use the version-appropriate schema baseline procedure documented in `production-deployment.md`.

The pure logic tests cover search normalization, review input validation, reviewer-name shortening and public output mapping. Full route authorization and unique-key concurrency must still be verified against MySQL 8.4 before launch.
