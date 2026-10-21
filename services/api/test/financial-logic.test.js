import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVE_PAYOUT_STATUSES,
  ACTIVE_REFUND_STATUSES,
  addDecimalAmounts,
  canApproveEarning,
  canRequestRefund,
  nextPayoutStatus,
  nextRefundStatus,
  normalizeExternalReference,
  normalizeFinanceNote
} from '../src/finance/financial-logic.js';

const future = new Date('2030-01-01T12:00:00.000Z');
const validRefund = {
  paymentStatus: 'paid', bookingStatus: 'confirmed', bookingStartAt: future,
  needsReconciliation: false, hostEarningStatus: 'pending', activeRefundStatus: null,
  now: new Date('2029-12-31T12:00:00.000Z').getTime()
};

test('refund is allowed only for a verified, reconciled, upcoming confirmed booking', () => {
  assert.equal(canRequestRefund(validRefund).ok, true);
  assert.equal(canRequestRefund({ ...validRefund, paymentStatus: 'pending' }).code, 'PAYMENT_NOT_REFUNDABLE');
  assert.equal(canRequestRefund({ ...validRefund, needsReconciliation: true }).code, 'PAYMENT_REQUIRES_RECONCILIATION');
  assert.equal(canRequestRefund({ ...validRefund, bookingStatus: 'checked_in' }).code, 'BOOKING_NOT_REFUNDABLE');
  assert.equal(canRequestRefund({ ...validRefund, bookingStartAt: new Date('2029-12-30T12:00:00.000Z') }).code, 'REFUND_WINDOW_CLOSED');
});

test('refund eligibility blocks settlement-reserved earnings and active or completed requests', () => {
  for (const status of ['payout_requested', 'paid', 'refund_hold']) {
    assert.equal(canRequestRefund({ ...validRefund, hostEarningStatus: status }).code, 'OWNER_SETTLEMENT_IN_PROGRESS');
  }
  for (const status of ACTIVE_REFUND_STATUSES.concat('succeeded')) {
    assert.equal(canRequestRefund({ ...validRefund, activeRefundStatus: status }).code, 'REFUND_ALREADY_EXISTS');
  }
});

test('refund transitions are explicit and reject invalid state changes', () => {
  assert.equal(nextRefundStatus('requested', 'approve'), 'approved');
  assert.equal(nextRefundStatus('requested', 'reject'), 'rejected');
  assert.equal(nextRefundStatus('approved', 'markSucceeded'), null);
  assert.equal(nextRefundStatus('approved', 'startProcessing'), 'processing');
  assert.equal(nextRefundStatus('processing', 'markSucceeded'), 'succeeded');
  assert.equal(nextRefundStatus('processing', 'markFailed'), 'failed');
  assert.equal(nextRefundStatus('processing', 'markManualReview'), 'manual_review');
  assert.equal(nextRefundStatus('manual_review', 'markSucceeded'), 'succeeded');
  assert.equal(nextRefundStatus('manual_review', 'markFailed'), 'failed');
  assert.equal(nextRefundStatus('succeeded', 'markManualReview'), null);
});

test('payout transitions prevent marking requested payout paid directly', () => {
  assert.equal(nextPayoutStatus('requested', 'approve'), 'approved');
  assert.equal(nextPayoutStatus('requested', 'markPaid'), null);
  assert.equal(nextPayoutStatus('approved', 'markPaid'), 'paid');
  assert.equal(nextPayoutStatus('approved', 'reject'), 'rejected');
  assert.equal(nextPayoutStatus('paid', 'markFailed'), null);
  assert.deepEqual(ACTIVE_PAYOUT_STATUSES, ['requested', 'approved', 'manual_review']);
});

test('host earnings approval requires completed booking and verified non-reconciled payment', () => {
  assert.equal(canApproveEarning({ earningStatus: 'pending', paymentStatus: 'paid', bookingStatus: 'completed' }).ok, true);
  assert.equal(canApproveEarning({ earningStatus: 'pending', paymentStatus: 'paid', bookingStatus: 'checked_in' }).code, 'BOOKING_NOT_COMPLETED');
  assert.equal(canApproveEarning({ earningStatus: 'pending', paymentStatus: 'pending', bookingStatus: 'completed' }).code, 'PAYMENT_NOT_VERIFIED');
  assert.equal(canApproveEarning({ earningStatus: 'pending', paymentStatus: 'paid', needsReconciliation: true, bookingStatus: 'completed' }).code, 'PAYMENT_REQUIRES_RECONCILIATION');
  assert.equal(canApproveEarning({ earningStatus: 'approved', paymentStatus: 'paid', bookingStatus: 'completed' }).code, 'EARNING_NOT_PENDING');
});

test('external references are trimmed, bounded and restricted to safe characters', () => {
  assert.equal(normalizeExternalReference('  bank-ref_123  '), 'bank-ref_123');
  assert.equal(normalizeExternalReference('ab'), null);
  assert.equal(normalizeExternalReference('ref with spaces'), null);
  assert.equal(normalizeExternalReference('bad<script>'), null);
  assert.equal(normalizeExternalReference('x'.repeat(181)), null);
});

test('finance notes are bounded and reject control characters', () => {
  assert.equal(normalizeFinanceNote(' Refund processed by finance '), 'Refund processed by finance');
  assert.equal(normalizeFinanceNote('no'), null);
  assert.equal(normalizeFinanceNote('note\u0000bad'), null);
  assert.equal(normalizeFinanceNote('x'.repeat(1001)), null);
});

test('amount summation uses decimal integer arithmetic instead of floating point', () => {
  assert.equal(addDecimalAmounts(['0.10', '0.20', '10', '1.01']), '11.31');
  assert.equal(addDecimalAmounts(['9999999999.98', '0.01']), '9999999999.99');
  assert.throws(() => addDecimalAmounts(['9999999999.99', '0.01']), /DECIMAL\(12,2\)/);
  assert.throws(() => addDecimalAmounts(['-1.00']), /decimal/);
  assert.throws(() => addDecimalAmounts(['1.001']), /decimal/);
});
