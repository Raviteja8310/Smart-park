import test from 'node:test';
import assert from 'node:assert/strict';
import { claimNextEmail, processOneEmail } from '../src/services/email-outbox-worker.js';

function fakePool(record = null) {
  const calls = [];
  return {
    calls,
    async getConnection() {
      return {
        async beginTransaction() { calls.push({ type: 'begin' }); },
        async commit() { calls.push({ type: 'commit' }); },
        async rollback() { calls.push({ type: 'rollback' }); },
        release() { calls.push({ type: 'release' }); },
        async execute(sql, params) {
          calls.push({ type: 'connection.execute', sql, params });
          if (sql.includes('SELECT id, idempotency_key')) return [[record].filter(Boolean)];
          return [{ affectedRows: 1 }];
        }
      };
    },
    async execute(sql, params) {
      calls.push({ type: 'pool.execute', sql, params });
      return [{ affectedRows: 1 }];
    }
  };
}

const record = (attempt_count = 0) => ({
  id: 'email-1', idempotency_key: 'booking-confirmed:booking-1',
  recipient_email: 'driver@example.com', template_key: 'booking_cancelled',
  template_data: JSON.stringify({ bookingCode: 'SP1234', lotName: 'Central Garage', slotCode: 'A-12' }),
  attempt_count
});
const silentLogger = { info() {}, error() {} };

test('worker claims due messages using a lease and SKIP LOCKED semantics', async () => {
  const db = fakePool(record(2));
  const claimed = await claimNextEmail(db, 'worker-test');
  assert.equal(claimed.id, 'email-1');
  assert.equal(claimed.attempt_count, 3);
  assert.equal(claimed.locked_by, 'worker-test');
  assert.deepEqual(claimed.template_data, { bookingCode: 'SP1234', lotName: 'Central Garage', slotCode: 'A-12' });
  const select = db.calls.find((call) => call.type === 'connection.execute' && call.sql.includes('SELECT id, idempotency_key'));
  assert.match(select.sql, /FOR UPDATE SKIP LOCKED/);
  const lock = db.calls.find((call) => call.type === 'connection.execute' && call.sql.includes("SET status = 'sending'"));
  assert.deepEqual(lock.params, [3, 'worker-test', 'email-1']);
  assert.ok(db.calls.some((call) => call.type === 'commit'));
  assert.ok(db.calls.some((call) => call.type === 'release'));
});

test('worker returns no work when queue has no due messages', async () => {
  const db = fakePool(null);
  assert.equal(await claimNextEmail(db, 'worker-test'), null);
  assert.ok(db.calls.some((call) => call.type === 'commit'));
});

test('successful SMTP delivery marks an email sent and saves provider ID', async () => {
  const db = fakePool(record(0));
  const result = await processOneEmail(db, async () => ({ simulated: false, messageId: 'smtp-message-1' }), silentLogger, 'worker-test');
  assert.deepEqual(result, { processed: true, sent: true, simulated: false });
  const update = db.calls.find((call) => call.type === 'pool.execute');
  assert.match(update.sql, /provider_message_id = \?/);
  assert.equal(update.params[0], 'sent');
  assert.equal(update.params[2], 'smtp-message-1');
  assert.equal(update.params[3], 'email-1');
  assert.equal(update.params[4], 'worker-test');
});

test('development simulation is recorded separately from delivered email', async () => {
  const db = fakePool(record(0));
  const result = await processOneEmail(db, async () => ({ simulated: true, messageId: null }), silentLogger, 'worker-test');
  assert.equal(result.simulated, true);
  const update = db.calls.find((call) => call.type === 'pool.execute');
  assert.equal(update.params[0], 'simulated');
  assert.equal(update.params[1], 1); // sent_at remains NULL for a simulation
});

test('transient SMTP failure schedules retry with bounded backoff and sanitized error code', async () => {
  const db = fakePool(record(0));
  const result = await processOneEmail(db, async () => { throw Object.assign(new Error('private SMTP detail'), { code: 'ETIMEDOUT;SECRET' }); }, silentLogger, 'worker-test');
  assert.equal(result.sent, false);
  assert.equal(result.failed, false);
  assert.equal(result.waitSeconds, 30);
  assert.equal(result.safeCode, 'ETIMEDOUTSECRET');
  const update = db.calls.find((call) => call.type === 'pool.execute');
  assert.equal(update.params[0], 'queued');
  assert.equal(update.params[1], 30);
  assert.equal(update.params[2], 'ETIMEDOUTSECRET: delivery attempt failed');
  assert.doesNotMatch(update.params[2], /private SMTP detail/);
});

test('eighth failed attempt moves the email to terminal failed status', async () => {
  const db = fakePool(record(7));
  const result = await processOneEmail(db, async () => { throw Object.assign(new Error('not logged'), { code: 'ECONNREFUSED' }); }, silentLogger, 'worker-test');
  assert.equal(result.failed, true);
  assert.equal(result.waitSeconds, 3600);
  const update = db.calls.find((call) => call.type === 'pool.execute');
  assert.equal(update.params[0], 'failed');
  assert.equal(update.params[1], 3600);
});
