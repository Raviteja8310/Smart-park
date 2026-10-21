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

test('database migration numbering is contiguous from 001 through 011', async () => {
  const names = await migrationFiles();
  assert.equal(names.length, 11);
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
