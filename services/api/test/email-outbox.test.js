import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueueTransactionalEmail } from '../src/services/email-outbox.js';

const data = { bookingCode: 'SP261020ABC123', lotName: 'Central Garage', slotCode: 'A-12' };
function fakeExecutor({ user = { email: 'driver@example.com', email_verified_at: new Date(), account_status: 'active' }, affectedRows = 1 } = {}) {
  const calls = [];
  return {
    calls,
    async execute(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('SELECT email, email_verified_at')) return [[user].filter(Boolean)];
      if (sql.includes('INSERT INTO transactional_email_outbox')) return [{ affectedRows }];
      throw new Error(`Unexpected SQL in test: ${sql}`);
    }
  };
}

test('email is queued for a verified active user using an idempotency key', async () => {
  const executor = fakeExecutor();
  const result = await enqueueTransactionalEmail(executor, {
    userId: 'user-1', idempotencyKey: 'booking-cancelled:booking-1',
    templateKey: 'booking_cancelled', data
  });
  assert.equal(result.queued, true);
  const insert = executor.calls[1];
  assert.match(insert.sql, /ON DUPLICATE KEY UPDATE/);
  assert.equal(insert.params[1], 'booking-cancelled:booking-1');
  assert.equal(insert.params[3], 'driver@example.com');
  assert.equal(insert.params[4], 'booking_cancelled');
  assert.deepEqual(JSON.parse(insert.params[5]), data);
});

test('email is not queued to an unverified, inactive, or missing account', async () => {
  for (const user of [
    { email: 'driver@example.com', email_verified_at: null, account_status: 'active' },
    { email: 'driver@example.com', email_verified_at: new Date(), account_status: 'suspended' },
    null
  ]) {
    const executor = fakeExecutor({ user });
    const result = await enqueueTransactionalEmail(executor, {
      userId: 'user-1', idempotencyKey: 'booking-cancelled:booking-1', templateKey: 'booking_cancelled', data
    });
    assert.equal(result.queued, false);
    assert.equal(executor.calls.length, 1);
  }
});

test('duplicate idempotency key does not create another queued email', async () => {
  const executor = fakeExecutor({ affectedRows: 0 });
  const result = await enqueueTransactionalEmail(executor, {
    userId: 'user-1', idempotencyKey: 'booking-cancelled:booking-1', templateKey: 'booking_cancelled', data
  });
  assert.equal(result.queued, false);
  assert.equal(result.duplicate, true);
});

test('invalid event keys and invalid template data are rejected', async () => {
  const executor = fakeExecutor();
  await assert.rejects(() => enqueueTransactionalEmail(executor, {
    userId: 'user-1', idempotencyKey: '', templateKey: 'booking_cancelled', data
  }), /idempotency/);
  await assert.rejects(() => enqueueTransactionalEmail(executor, {
    userId: 'user-1', idempotencyKey: 'key', templateKey: 'unsupported', data
  }), /Unsupported/);
});
