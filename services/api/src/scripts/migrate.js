import crypto from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { env } from '../config/env.js';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '../../../../');
const migrationsDir = join(projectRoot, 'database', 'migrations');
const MIGRATION_NAME = /^([0-9]{3})_[a-z0-9_-]+\.sql$/i;

const BASELINE_REQUIREMENTS = [
  { version: 1, tables: ['users', 'roles', 'user_roles', 'vehicles', 'parking_lots', 'parking_zones', 'parking_slots', 'pricing_rules', 'bookings', 'parking_sessions', 'payments', 'cameras', 'camera_slot_regions', 'occupancy_events', 'notifications', 'audit_logs'] },
  { version: 2, tables: ['user_sessions', 'email_verification_tokens', 'password_reset_tokens'] },
  { version: 3, tables: ['parking_lot_staff'], columns: [{ table: 'parking_slots', column: 'physical_state' }] },
  { version: 4, tables: ['payment_webhook_events'] },
  { version: 5, columns: [{ table: 'payments', column: 'needs_reconciliation' }] },
  { version: 6, tables: ['parking_listing_photos', 'parking_availability_rules', 'host_earnings'], columns: [{ table: 'parking_lots', column: 'listing_kind' }] },
  { version: 7, columns: [{ table: 'cameras', column: 'detector_mode' }, { table: 'cameras', column: 'last_frame_at' }, { table: 'camera_slot_regions', column: 'is_active' }] },
  { version: 8, tables: ['operational_alerts'], columns: [{ table: 'payments', column: 'needs_reconciliation' }] },
  { version: 9, tables: ['transactional_email_outbox'] },
  { version: 10, tables: ['refund_requests', 'host_payout_requests', 'host_payout_allocations'], enumValues: [
    { table: 'refund_requests', column: 'status', values: ['processing'] },
    { table: 'host_earnings', column: 'status', values: ['payout_requested', 'refund_hold'] }
  ] },
  { version: 11, tables: ['parking_favorites', 'parking_search_history', 'parking_reviews'], columns: [
    { table: 'parking_favorites', column: 'user_id' },
    { table: 'parking_favorites', column: 'parking_lot_id' },
    { table: 'parking_favorites', column: 'created_at' },
    { table: 'parking_search_history', column: 'query_text' },
    { table: 'parking_search_history', column: 'city' },
    { table: 'parking_search_history', column: 'searched_at' },
    { table: 'parking_reviews', column: 'booking_id' },
    { table: 'parking_reviews', column: 'user_id' },
    { table: 'parking_reviews', column: 'rating' },
    { table: 'parking_reviews', column: 'review_title' },
    { table: 'parking_reviews', column: 'review_text' },
    { table: 'parking_reviews', column: 'status' },
    { table: 'parking_reviews', column: 'created_at' },
    { table: 'parking_reviews', column: 'updated_at' }
  ], enumValues: [
    { table: 'parking_reviews', column: 'status', values: ['published', 'hidden'] }
  ] },
  { version: 12, columns: [
    { table: 'parking_lots', column: 'surface_type' },
    { table: 'parking_lots', column: 'space_length_cm' },
    { table: 'parking_lots', column: 'space_width_cm' },
    { table: 'parking_lots', column: 'max_vehicle_height_cm' }
  ], enumValues: [
    { table: 'parking_lots', column: 'surface_type', values: ['asphalt', 'concrete', 'pavers', 'gravel', 'dirt', 'other'] }
  ] },
  { version: 13, columns: [
    { table: 'parking_lots', column: 'review_status' },
    { table: 'parking_lots', column: 'review_note' },
    { table: 'parking_lots', column: 'reviewed_by_user_id' },
    { table: 'parking_lots', column: 'reviewed_at' }
  ], enumValues: [
    { table: 'parking_lots', column: 'review_status', values: ['not_reviewed', 'pending', 'approved', 'rejected'] }
  ] },
  { version: 14, tables: ['owner_verification_requests'], columns: [
    { table: 'owner_verification_requests', column: 'user_id' },
    { table: 'owner_verification_requests', column: 'legal_name' },
    { table: 'owner_verification_requests', column: 'property_relationship' },
    { table: 'owner_verification_requests', column: 'document_type' },
    { table: 'owner_verification_requests', column: 'status' },
    { table: 'owner_verification_requests', column: 'reviewed_by_user_id' }
  ], enumValues: [
    { table: 'owner_verification_requests', column: 'status', values: ['pending', 'approved', 'rejected'] }
  ] },
  { version: 15, tables: ['promo_codes', 'promo_redemptions'], columns: [
    { table: 'promo_codes', column: 'code' },
    { table: 'promo_codes', column: 'discount_type' },
    { table: 'promo_codes', column: 'discount_value' },
    { table: 'promo_codes', column: 'is_active' },
    { table: 'promo_redemptions', column: 'booking_id' },
    { table: 'promo_redemptions', column: 'discount_amount' },
    { table: 'promo_redemptions', column: 'status' }
  ], enumValues: [
    { table: 'promo_codes', column: 'discount_type', values: ['percent', 'fixed'] },
    { table: 'promo_redemptions', column: 'status', values: ['reserved', 'redeemed', 'released'] }
  ] },
  { version: 16, tables: ['referral_codes', 'referrals', 'referral_rewards'], columns: [
    { table: 'referral_codes', column: 'code' },
    { table: 'referrals', column: 'referrer_user_id' },
    { table: 'referrals', column: 'referred_user_id' },
    { table: 'referrals', column: 'qualifying_booking_id' },
    { table: 'referral_rewards', column: 'beneficiary_user_id' },
    { table: 'referral_rewards', column: 'reward_amount' },
    { table: 'referral_rewards', column: 'status' }
  ], enumValues: [
    { table: 'referrals', column: 'status', values: ['pending', 'qualified', 'rejected'] },
    { table: 'referral_rewards', column: 'status', values: ['available', 'reversed'] }
  ] },
  { version: 17, tables: ['parking_subscriptions'], columns: [
    { table: 'parking_subscriptions', column: 'user_id' },
    { table: 'parking_subscriptions', column: 'parking_lot_id' },
    { table: 'parking_subscriptions', column: 'owner_user_id' },
    { table: 'parking_subscriptions', column: 'start_date' },
    { table: 'parking_subscriptions', column: 'end_date' },
    { table: 'parking_subscriptions', column: 'monthly_amount' },
    { table: 'parking_subscriptions', column: 'payment_status' },
    { table: 'parking_subscriptions', column: 'status' }
  ], enumValues: [
    { table: 'parking_subscriptions', column: 'status', values: ['pending', 'approved', 'rejected', 'cancelled', 'expired'] },
    { table: 'parking_subscriptions', column: 'payment_status', values: ['unpaid', 'paid', 'failed', 'refunded'] }
  ] },
  { version: 18, tables: ['corporate_accounts', 'corporate_members', 'corporate_fleet_vehicles', 'ev_chargers', 'ev_charging_sessions'], columns: [
    { table: 'corporate_accounts', column: 'created_by_user_id' },
    { table: 'corporate_members', column: 'member_role' },
    { table: 'corporate_fleet_vehicles', column: 'registration_number' },
    { table: 'ev_chargers', column: 'connector_type' },
    { table: 'ev_chargers', column: 'price_per_kwh' },
    { table: 'ev_charging_sessions', column: 'price_per_kwh_snapshot' },
    { table: 'ev_charging_sessions', column: 'status' }
  ], enumValues: [
    { table: 'corporate_accounts', column: 'status', values: ['active', 'suspended'] },
    { table: 'corporate_members', column: 'member_role', values: ['manager', 'employee', 'driver'] },
    { table: 'ev_chargers', column: 'availability_status', values: ['available', 'occupied', 'maintenance', 'offline'] },
    { table: 'ev_charging_sessions', column: 'status', values: ['active', 'completed', 'cancelled'] }
  ] },
  { version: 19, tables: ['anpr_events'], columns: [
    { table: 'anpr_events', column: 'camera_id' },
    { table: 'anpr_events', column: 'normalized_plate' },
    { table: 'anpr_events', column: 'confidence' },
    { table: 'anpr_events', column: 'match_status' },
    { table: 'anpr_events', column: 'review_status' }
  ], enumValues: [
    { table: 'anpr_events', column: 'direction', values: ['entry', 'exit', 'unknown'] },
    { table: 'anpr_events', column: 'review_status', values: ['pending', 'confirmed', 'false_positive'] }
  ] },
  { version: 20, columns: [{ table: 'password_reset_tokens', column: 'attempt_count' }] },
  { version: 21, tables: ['overstay_incidents', 'gate_devices', 'gate_device_commands', 'support_tickets', 'support_ticket_messages', 'user_notification_preferences'], columns: [
    { table: 'notifications', column: 'delivery_attempt_count' },
    { table: 'notifications', column: 'next_attempt_at' },
    { table: 'notifications', column: 'delivery_locked_until' }
  ], enumValues: [{ table: 'notifications', column: 'delivery_status', values: ['sending'] }] }
];

function migrationVersion(name) {
  const match = MIGRATION_NAME.exec(name);
  return match ? Number(match[1]) : null;
}

function checksum(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function listMigrations() {
  const names = (await readdir(migrationsDir))
    .filter((name) => MIGRATION_NAME.test(name))
    .sort();
  if (!names.length) throw new Error(`No numbered SQL migrations were found in ${migrationsDir}.`);
  const versions = names.map(migrationVersion);
  for (let index = 0; index < versions.length; index += 1) {
    if (versions[index] !== index + 1) {
      throw new Error(`Migration numbering must be contiguous starting at 001; expected ${String(index + 1).padStart(3, '0')}, found ${names[index]}.`);
    }
  }
  return Promise.all(names.map(async (name) => {
    const content = await readFile(join(migrationsDir, name), 'utf8');
    return { name, version: migrationVersion(name), content, checksum: checksum(content) };
  }));
}

async function ensureHistoryTable(connection) {
  await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    migration_name VARCHAR(190) PRIMARY KEY,
    checksum CHAR(64) NOT NULL,
    status ENUM('running','applied','failed') NOT NULL,
    started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    applied_at DATETIME(3) NULL,
    error_summary VARCHAR(500) NULL
  ) ENGINE=InnoDB`);
}

async function assertBaselineSchema(connection, targetVersion) {
  const [tableRows] = await connection.execute(
    `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()`
  );
  const tables = new Set(tableRows.map((row) => row.TABLE_NAME));
  const [columnRows] = await connection.execute(
    `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()`
  );
  const columns = new Set(columnRows.map((row) => `${row.TABLE_NAME}.${row.COLUMN_NAME}`));
  const columnTypes = new Map(columnRows.map((row) => [`${row.TABLE_NAME}.${row.COLUMN_NAME}`, String(row.COLUMN_TYPE ?? '')]));
  const missing = [];
  for (const requirement of BASELINE_REQUIREMENTS.filter((item) => item.version <= targetVersion)) {
    for (const table of requirement.tables ?? []) if (!tables.has(table)) missing.push(`table ${table} (migration ${String(requirement.version).padStart(3, '0')})`);
    for (const item of requirement.columns ?? []) if (!columns.has(`${item.table}.${item.column}`)) missing.push(`column ${item.table}.${item.column} (migration ${String(requirement.version).padStart(3, '0')})`);
    for (const item of requirement.enumValues ?? []) {
      const type = columnTypes.get(`${item.table}.${item.column}`) ?? '';
      for (const enumValue of item.values) if (!type.includes(`'${enumValue}'`)) missing.push(`enum value '${enumValue}' on ${item.table}.${item.column} (migration ${String(requirement.version).padStart(3, '0')})`);
    }
  }
  if (missing.length) {
    throw new Error(`Schema baseline refused because expected objects are missing:\n- ${missing.join('\n- ')}\nApply the missing migrations before baselining.`);
  }
}

async function baseline(connection, migrations, targetText) {
  const targetVersion = Number(targetText);
  if (!Number.isInteger(targetVersion) || targetVersion < 1) throw new Error('Usage: npm run migrate -- --baseline 014 --confirm-existing-schema');
  const upto = migrations.filter((migration) => migration.version <= targetVersion);
  if (!upto.length || upto.at(-1).version !== targetVersion) throw new Error(`Migration version ${targetText} was not found.`);
  if (!process.argv.includes('--confirm-existing-schema')) {
    throw new Error('Baselining records existing schema only; add --confirm-existing-schema after taking a backup and checking the schema.');
  }
  const [rows] = await connection.execute('SELECT COUNT(*) AS count FROM schema_migrations');
  if (Number(rows[0].count) !== 0) throw new Error('Cannot baseline: schema_migrations already contains records.');
  await assertBaselineSchema(connection, targetVersion);
  for (const migration of upto) {
    await connection.execute(
      `INSERT INTO schema_migrations (migration_name, checksum, status, started_at, applied_at)
       VALUES (?, ?, 'applied', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [migration.name, migration.checksum]
    );
  }
  console.log(`Baselined ${upto.length} migration(s) through ${String(targetVersion).padStart(3, '0')}. No SQL was executed. Verify this matches your backed-up existing database.`);
}

async function runMigrations(connection, migrations) {
  const [historyRows] = await connection.execute('SELECT migration_name, checksum, status FROM schema_migrations');
  const history = new Map(historyRows.map((row) => [row.migration_name, row]));
  const blocked = historyRows.filter((row) => row.status !== 'applied');
  if (blocked.length) {
    throw new Error(`Found incomplete migration state (${blocked.map((row) => `${row.migration_name}:${row.status}`).join(', ')}). Do not rerun automatically; inspect and repair the affected schema, then update schema_migrations deliberately.`);
  }

  for (const [index, migration] of migrations.entries()) {
    const existing = history.get(migration.name);
    if (existing) {
      if (existing.checksum !== migration.checksum) {
        throw new Error(`Migration ${migration.name} has changed since it was recorded. Never edit an applied migration; create a new numbered migration instead.`);
      }
      continue;
    }
    const earlierMissing = migrations.slice(0, index).find((item) => !history.has(item.name));
    if (earlierMissing) throw new Error(`Cannot apply ${migration.name} while earlier migration ${earlierMissing.name} is not recorded.`);

    await connection.execute(
      `INSERT INTO schema_migrations (migration_name, checksum, status) VALUES (?, ?, 'running')`,
      [migration.name, migration.checksum]
    );
    console.log(`Applying ${migration.name}...`);
    try {
      // MySQL DDL implicitly commits. If interrupted, the recorded running/failed state
      // intentionally blocks automatic replay because the SQL may be partially applied.
      await connection.query(migration.content);
      await connection.execute(
        `UPDATE schema_migrations SET status = 'applied', applied_at = UTC_TIMESTAMP(3), error_summary = NULL WHERE migration_name = ?`,
        [migration.name]
      );
      history.set(migration.name, { migration_name: migration.name, checksum: migration.checksum, status: 'applied' });
      console.log(`Applied ${migration.name}`);
    } catch (error) {
      await connection.execute(
        `UPDATE schema_migrations SET status = 'failed', error_summary = ? WHERE migration_name = ?`,
        [String(error?.code ?? error?.message ?? 'migration failed').slice(0, 500), migration.name]
      ).catch(() => {});
      throw new Error(`Migration ${migration.name} failed. Its status is recorded as failed to prevent a dangerous automatic replay. Inspect the schema and error, then repair manually. Database error: ${error?.code ?? error?.message ?? 'unknown'}`);
    }
  }
  console.log('Migration check complete. All numbered migrations are recorded as applied.');
}

let connection;
try {
  const migrations = await listMigrations();
  connection = await mysql.createConnection({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    multipleStatements: true,
    timezone: 'Z'
  });
  await ensureHistoryTable(connection);
  const baselineIndex = process.argv.indexOf('--baseline');
  if (baselineIndex >= 0) {
    await baseline(connection, migrations, process.argv[baselineIndex + 1]);
  } else {
    await runMigrations(connection, migrations);
  }
} catch (error) {
  console.error(error?.message ?? error);
  process.exitCode = 1;
} finally {
  if (connection) await connection.end().catch(() => {});
}
