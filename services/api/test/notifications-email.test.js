import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotification } from '../src/services/notifications.js';

const email = {
  templateKey: 'booking_cancelled',
  idempotencyKey: 'booking-cancelled:booking-1',
  data: { bookingCode: 'SP1234', lotName: 'Central Garage', slotCode: 'A-12' }
};

function executor({ notificationFails = false, outboxFails = false } = {}) {
  const calls = [];
  return {
    calls,
    async execute(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('INSERT INTO notifications')) {
        if (notificationFails) throw Object.assign(new Error('notification insert failed'), { code: 'TEST_NOTIFICATION_ERROR' });
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('SELECT email, email_verified_at')) return [[{ email: 'driver@example.com', email_verified_at: new Date(), account_status: 'active' }]];
      if (sql.includes('INSERT INTO transactional_email_outbox')) {
        if (outboxFails) throw Object.assign(new Error('outbox insert failed'), { code: 'TEST_OUTBOX_ERROR' });
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL in test: ${sql}`);
    }
  };
}

test('business notification and transactional email use the same executor/transaction', async () => {
  const db = executor();
  const result = await createNotification(db, {
    userId: 'user-1', eventType: 'booking.cancelled', title: 'Hold cancelled', message: 'The hold was cancelled.', email
  });
  assert.equal(result, true);
  assert.equal(db.calls.length, 3);
  assert.match(db.calls[0].sql, /INSERT INTO notifications/);
  assert.match(db.calls[1].sql, /SELECT email, email_verified_at/);
  assert.match(db.calls[2].sql, /INSERT INTO transactional_email_outbox/);
});

test('email outbox failure propagates so surrounding business transaction can roll back', async () => {
  const db = executor({ outboxFails: true });
  await assert.rejects(() => createNotification(db, {
    userId: 'user-1', eventType: 'booking.cancelled', title: 'Hold cancelled', message: 'The hold was cancelled.', email
  }), /outbox insert failed/);
});

test('in-app inbox failure does not suppress a requested transactional email', async () => {
  const db = executor({ notificationFails: true });
  const warn = console.warn;
  console.warn = () => {};
  try {
    const result = await createNotification(db, {
      userId: 'user-1', eventType: 'booking.cancelled', title: 'Hold cancelled', message: 'The hold was cancelled.', email
    });
    assert.equal(result, false);
    assert.ok(db.calls.some((call) => call.sql.includes('INSERT INTO transactional_email_outbox')));
  } finally {
    console.warn = warn;
  }
});
