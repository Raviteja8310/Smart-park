import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '../../..');
const migrationsDir = join(projectRoot, 'database/migrations');

async function migrationFiles() {
  return (await readdir(migrationsDir)).filter((name) => /^\d{3}_.+\.sql$/.test(name)).sort();
}

test('database migration numbering is contiguous from 001 through 021', async () => {
  const names = await migrationFiles();
  assert.equal(names.length, 21);
  names.forEach((name, index) => assert.equal(Number(name.slice(0, 3)), index + 1, `Unexpected migration order at ${name}`));
});

test('engagement migration defines favorites scoped by account and facility', async () => {
  const sql = await readFile(join(migrationsDir, '011_favorites_search_reviews.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS parking_favorites/i);
  assert.match(sql, /PRIMARY KEY \(user_id, parking_lot_id\)/i);
  assert.match(sql, /FOREIGN KEY \(user_id\) REFERENCES users\(id\)/i);
  assert.match(sql, /FOREIGN KEY \(parking_lot_id\) REFERENCES parking_lots\(id\)/i);
});

test('review schema enforces one review per booking and a bounded rating', async () => {
  const sql = await readFile(join(migrationsDir, '011_favorites_search_reviews.sql'), 'utf8');
  assert.match(sql, /UNIQUE KEY uq_parking_review_booking_user \(booking_id, user_id\)/i);
  assert.match(sql, /CHECK \(rating BETWEEN 1 AND 5\)/i);
  assert.match(sql, /status ENUM\('published','hidden'\)/i);
  assert.match(sql, /FOREIGN KEY \(booking_id\) REFERENCES bookings\(id\)/i);
});

test('migration baseline requires engagement columns and review status enum values', async () => {
  const source = await readFile(join(projectRoot, 'services/api/src/scripts/migrate.js'), 'utf8');
  assert.match(source, /version: 11, tables: \['parking_favorites', 'parking_search_history', 'parking_reviews'\]/);
  for (const column of ['review_text', 'review_title', 'booking_id', 'user_id', 'updated_at']) {
    assert.match(source, new RegExp(`table: 'parking_reviews', column: '${column}'`));
  }
  assert.match(source, /values: \['published', 'hidden'\]/);
});

test('engagement API is mounted and migration is covered in operator documentation', async () => {
  const appSource = await readFile(join(projectRoot, 'services/api/src/app.js'), 'utf8');
  const readme = await readFile(join(projectRoot, 'README.md'), 'utf8');
  assert.match(appSource, /app\.use\('\/api\/engagement', engagementRouter\)/);
  assert.match(readme, /011_favorites_search_reviews\.sql/);
  assert.match(readme, /Phase 12: saved parking, recent searches and verified reviews/);
});


test('shared listing dimensions migration adds optional validated space details', async () => {
  const sql = await readFile(join(migrationsDir, '012_shared_listing_space_dimensions.sql'), 'utf8');
  for (const column of ['surface_type', 'space_length_cm', 'space_width_cm', 'max_vehicle_height_cm']) {
    assert.match(sql, new RegExp(`ADD COLUMN ${column}`, 'i'));
  }
  assert.match(sql, /DEFAULT 'other'/i);
  assert.match(sql, /CHECK \(space_length_cm IS NULL OR space_length_cm BETWEEN 1 AND 3000\)/i);
  assert.match(sql, /CHECK \(space_width_cm IS NULL OR space_width_cm BETWEEN 1 AND 3000\)/i);
  assert.match(sql, /CHECK \(max_vehicle_height_cm IS NULL OR max_vehicle_height_cm BETWEEN 1 AND 3000\)/i);
});

test('migration baseline validates shared listing physical-detail columns', async () => {
  const source = await readFile(join(projectRoot, 'services/api/src/scripts/migrate.js'), 'utf8');
  assert.match(source, /version: 12, columns:/);
  for (const column of ['surface_type', 'space_length_cm', 'space_width_cm', 'max_vehicle_height_cm']) {
    assert.match(source, new RegExp(`table: 'parking_lots', column: '${column}'`));
  }
});

test('shared listing API and host form expose physical-space details', async () => {
  const route = await readFile(join(projectRoot, 'services/api/src/routes/marketplace.routes.js'), 'utf8');
  const component = await readFile(join(projectRoot, 'apps/web/src/components/MarketplacePage.jsx'), 'utf8');
  for (const field of ['surfaceType', 'spaceLengthCm', 'spaceWidthCm', 'maxVehicleHeightCm']) {
    assert.match(route, new RegExp(`${field}:`));
    assert.match(component, new RegExp(field));
  }
  assert.match(route, /space_length_cm/);
  assert.match(route, /space_width_cm/);
  assert.match(route, /max_vehicle_height_cm/);
});


test('listing review migration stores moderation decision, note and reviewer audit reference', async () => {
  const sql = await readFile(join(migrationsDir, '013_listing_review_workflow.sql'), 'utf8');
  for (const column of ['review_status', 'review_note', 'reviewed_by_user_id', 'reviewed_at']) {
    assert.match(sql, new RegExp(`ADD COLUMN ${column}`, 'i'));
  }
  assert.match(sql, /ENUM\('not_reviewed','pending','approved','rejected'\)/i);
  assert.match(sql, /FOREIGN KEY \(reviewed_by_user_id\) REFERENCES users\(id\)/i);
});

test('marketplace moderation API enforces admin review and owner-visible rejection feedback', async () => {
  const route = await readFile(join(projectRoot, 'services/api/src/routes/marketplace.routes.js'), 'utf8');
  const component = await readFile(join(projectRoot, 'apps/web/src/components/MarketplacePage.jsx'), 'utf8');
  assert.match(route, /router\.post\('\/listings\/:listingId\/review', requireAuth, requireRole\('admin'\)/);
  assert.match(route, /Only listings currently awaiting review can be approved or rejected/);
  assert.match(route, /review_note = NULL/);
  assert.match(component, /Reject with reason/);
  assert.match(component, /selectedListing\.reviewNote/);
});


test('migration runner baseline validates the listing review workflow columns and enum values', async () => {
  const source = await readFile(join(projectRoot, 'services/api/src/scripts/migrate.js'), 'utf8');
  assert.match(source, /version: 13, columns:/);
  for (const column of ['review_status', 'review_note', 'reviewed_by_user_id', 'reviewed_at']) {
    assert.match(source, new RegExp(`table: 'parking_lots', column: '${column}'`));
  }
  assert.match(source, /values: \['not_reviewed', 'pending', 'approved', 'rejected'\]/);
});


test('owner verification migration stores private review metadata without full document numbers', async () => {
  const sql = await readFile(join(migrationsDir, '014_owner_verification.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE owner_verification_requests/i);
  assert.match(sql, /document_reference_last4 CHAR\(4\)/i);
  assert.doesNotMatch(sql, /document_number|document_image_url|identity_image_url/i);
  assert.match(sql, /FOREIGN KEY \(reviewed_by_user_id\) REFERENCES users\(id\)/i);
});

test('owner verification endpoints are mounted and protected by role checks', async () => {
  const [app, route, runner] = await Promise.all([
    readFile(join(projectRoot, 'services/api/src/app.js'), 'utf8'),
    readFile(join(projectRoot, 'services/api/src/routes/owner-verification.routes.js'), 'utf8'),
    readFile(join(projectRoot, 'services/api/src/scripts/migrate.js'), 'utf8')
  ]);
  assert.match(app, /app\.use\(['"]\/api\/owner-verification['"], ownerVerificationRouter\)/);
  assert.match(route, /router\.post\(['"]\/submit['"], requireAuth, requireRole\('host','admin'\)/);
  assert.match(route, /router\.get\(['"]\/admin['"], requireAuth, requireRole\('admin'\)/);
  assert.match(runner, /version: 14, tables: \['owner_verification_requests'\]/);
});


test('promotion migration enforces discount bounds and auditable booking redemptions', async () => {
  const sql = await readFile(join(migrationsDir, '015_promotions.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS promo_codes/i);
  assert.match(sql, /UNIQUE KEY|UNIQUE/i);
  assert.match(sql, /discount_type ENUM\('percent','fixed'\)/i);
  assert.match(sql, /max_redemptions_per_user/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS promo_redemptions/i);
  assert.match(sql, /booking_id CHAR\(36\) NOT NULL UNIQUE/i);
  assert.match(sql, /status ENUM\('reserved','redeemed','released'\)/i);
});

test('promotion API is mounted and migration baseline validates promotion tables', async () => {
  const [app, route, runner] = await Promise.all([
    readFile(join(projectRoot, 'services/api/src/app.js'), 'utf8'),
    readFile(join(projectRoot, 'services/api/src/routes/promotions.routes.js'), 'utf8'),
    readFile(join(projectRoot, 'services/api/src/scripts/migrate.js'), 'utf8')
  ]);
  assert.match(app, /app\.use\(['"]\/api\/promotions['"], promotionsRouter\)/);
  assert.match(route, /router\.post\(['"]\/admin['"], requireAuth, requireRole\('admin'\)/);
  assert.match(route, /max_redemptions_per_user/);
  assert.match(runner, /version: 15, tables: \['promo_codes', 'promo_redemptions'\]/);
});


test('monthly subscriptions migration records owner-reviewed passes and payment state separately', async () => {
  const sql = await readFile(join(migrationsDir, '017_monthly_subscriptions.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS parking_subscriptions/i);
  assert.match(sql, /FOREIGN KEY \(user_id\) REFERENCES users\(id\)/i);
  assert.match(sql, /FOREIGN KEY \(parking_lot_id\) REFERENCES parking_lots\(id\)/i);
  assert.match(sql, /status ENUM\('pending','approved','rejected','cancelled','expired'\)/i);
  assert.match(sql, /payment_status ENUM\('unpaid','paid','failed','refunded'\)/i);
  assert.match(sql, /CHECK \(months_count BETWEEN 1 AND 12\)/i);
});

test('monthly subscription API is mounted and owner review is scoped', async () => {
  const [app, route, runner] = await Promise.all([
    readFile(join(projectRoot, 'services/api/src/app.js'), 'utf8'),
    readFile(join(projectRoot, 'services/api/src/routes/subscriptions.routes.js'), 'utf8'),
    readFile(join(projectRoot, 'services/api/src/scripts/migrate.js'), 'utf8')
  ]);
  assert.match(app, /app\.use\('\/api\/subscriptions', subscriptionsRouter\)/);
  assert.match(route, /router\.post\('\/', requireAuth/);
  assert.match(route, /pass\.owner_user_id !== req\.user\.id/);
  assert.match(route, /Only pending monthly pass requests can be reviewed/);
  assert.match(route, /payment collection, recurring billing/i);
  assert.match(runner, /version: 17, tables: \['parking_subscriptions'\]/);
});


test('corporate fleet and EV charging migration defines membership, fleet, charger, and session records', async () => {
  const sql = await readFile(join(migrationsDir, '018_corporate_fleet_ev_charging.sql'), 'utf8');
  for (const table of ['corporate_accounts', 'corporate_members', 'corporate_fleet_vehicles', 'ev_chargers', 'ev_charging_sessions']) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`, 'i'));
  assert.match(sql, /UNIQUE KEY uq_corporate_member/);
  assert.match(sql, /UNIQUE KEY uq_corporate_fleet_registration/);
  assert.match(sql, /price_per_kwh_snapshot/);
});


test('ANPR migration stores text candidates without image blobs and enforces confidence bounds', async () => {
  const sql = await readFile(join(migrationsDir, '019_anpr_events.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS anpr_events/i);
  assert.match(sql, /normalized_plate VARCHAR\(24\)/i);
  assert.match(sql, /CHECK \(confidence >= 0 AND confidence <= 1\)/i);
  assert.match(sql, /review_status ENUM\('pending','confirmed','false_positive'\)/i);
  assert.doesNotMatch(sql, /image_blob|frame_data|raw_image/i);
});

test('ANPR callback is service-token protected and explicitly does not automate gate decisions', async () => {
  const route = await readFile(join(projectRoot, 'services/api/src/routes/vision.routes.js'), 'utf8');
  assert.match(route, /router\.post\('\/service\/plate-events', requireVisionService/);
  assert.match(route, /never opens a gate or changes booking state/i);
  assert.match(route, /vision\.plate_event_reviewed/);
});


test('remaining-phases migration adds overstay, hardware, support and SMS delivery storage', async () => {
  const sql = await readFile(join(migrationsDir, '021_overstay_gates_support_sms.sql'), 'utf8');
  for (const table of ['overstay_incidents', 'gate_devices', 'gate_device_commands', 'support_tickets', 'support_ticket_messages', 'user_notification_preferences']) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`, 'i'));
  }
  for (const column of ['delivery_attempt_count', 'next_attempt_at', 'delivery_last_error', 'provider_message_id', 'delivery_locked_until']) {
    assert.match(sql, new RegExp(`ADD COLUMN ${column}`, 'i'));
  }
  const baseline = await readFile(join(projectRoot, 'services/api/src/scripts/migrate.js'), 'utf8');
  assert.match(baseline, /version: 21, tables: \['overstay_incidents', 'gate_devices', 'gate_device_commands', 'support_tickets', 'support_ticket_messages', 'user_notification_preferences'\]/);
});
