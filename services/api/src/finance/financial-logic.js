export const ACTIVE_REFUND_STATUSES = Object.freeze(['requested', 'approved', 'processing', 'manual_review']);
export const ACTIVE_PAYOUT_STATUSES = Object.freeze(['requested', 'approved', 'manual_review']);

export function canRequestRefund({
  paymentStatus,
  needsReconciliation = false,
  bookingStatus,
  bookingStartAt,
  hostEarningStatus = null,
  activeRefundStatus = null,
  now = Date.now()
}) {
  if (paymentStatus !== 'paid') return { ok: false, code: 'PAYMENT_NOT_REFUNDABLE', message: 'Only a verified captured payment can be considered for a refund.' };
  if (needsReconciliation) return { ok: false, code: 'PAYMENT_REQUIRES_RECONCILIATION', message: 'This payment must be reconciled before a refund request can be opened.' };
  if (bookingStatus !== 'confirmed') return { ok: false, code: 'BOOKING_NOT_REFUNDABLE', message: 'Only a confirmed booking that has not entered or completed can be considered.' };
  const start = bookingStartAt instanceof Date ? bookingStartAt.getTime() : new Date(bookingStartAt).getTime();
  if (!Number.isFinite(start) || start <= now) return { ok: false, code: 'REFUND_WINDOW_CLOSED', message: 'Refund requests must be submitted before the booking start time.' };
  if (['payout_requested', 'paid', 'refund_hold'].includes(hostEarningStatus)) {
    return { ok: false, code: 'OWNER_SETTLEMENT_IN_PROGRESS', message: 'The host earning is being settled or reviewed; support must resolve it before this refund can be requested.' };
  }
  if ([...ACTIVE_REFUND_STATUSES, 'succeeded'].includes(activeRefundStatus)) {
    return { ok: false, code: 'REFUND_ALREADY_EXISTS', message: 'An active or completed refund record already exists for this payment.' };
  }
  return { ok: true };
}

export function nextRefundStatus(currentStatus, action) {
  const transitions = {
    approve: { requested: 'approved' },
    reject: { requested: 'rejected', approved: 'rejected' },
    startProcessing: { approved: 'processing' },
    markSucceeded: { processing: 'succeeded', manual_review: 'succeeded' },
    markFailed: { approved: 'failed', processing: 'failed', manual_review: 'failed' },
    markManualReview: { processing: 'manual_review' }
  };
  return transitions[action]?.[currentStatus] ?? null;
}

export function nextPayoutStatus(currentStatus, action) {
  const transitions = {
    approve: { requested: 'approved' },
    reject: { requested: 'rejected', approved: 'rejected' },
    markPaid: { approved: 'paid', manual_review: 'paid' },
    markFailed: { approved: 'failed', manual_review: 'failed' },
    markManualReview: { approved: 'manual_review' }
  };
  return transitions[action]?.[currentStatus] ?? null;
}

export function canApproveEarning({ earningStatus, paymentStatus, needsReconciliation = false, bookingStatus }) {
  if (earningStatus !== 'pending') return { ok: false, code: 'EARNING_NOT_PENDING' };
  if (paymentStatus !== 'paid') return { ok: false, code: 'PAYMENT_NOT_VERIFIED' };
  if (needsReconciliation) return { ok: false, code: 'PAYMENT_REQUIRES_RECONCILIATION' };
  if (bookingStatus !== 'completed') return { ok: false, code: 'BOOKING_NOT_COMPLETED' };
  return { ok: true };
}

export function normalizeExternalReference(value) {
  if (typeof value !== 'string') return null;
  const reference = value.trim();
  if (reference.length < 3 || reference.length > 180 || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(reference)) return null;
  return reference;
}

export function normalizeFinanceNote(value, { min = 5, max = 1000 } = {}) {
  if (typeof value !== 'string') return null;
  const note = value.trim();
  if (note.length < min || note.length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(note)) return null;
  return note;
}

export function addDecimalAmounts(values) {
  let cents = 0n;
  for (const value of values) {
    const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(String(value ?? '').trim());
    if (!match) throw new TypeError('Amount must be a decimal with at most two fractional digits.');
    cents += BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0') || '0');
  }
  if (cents > 999_999_999_999n) throw new RangeError('Amount exceeds the DECIMAL(12,2) storage maximum.');
  const whole = cents / 100n;
  const fraction = String(cents % 100n).padStart(2, '0');
  return `${whole}.${fraction}`;
}
