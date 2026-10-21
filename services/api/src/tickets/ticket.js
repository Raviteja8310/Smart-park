import { constantTimeStringEqual, createSignedTicket, sha256Hex, verifySignedTicket } from '../payments/payment-logic.js';

export function createBookingTicket(booking, secret, options = {}) {
  const ticket = createSignedTicket({ bookingId: booking.id, endAt: booking.end_at ?? booking.endAt, secret, ...options });
  return { ...ticket, tokenHash: sha256Hex(ticket.token) };
}

export function validateBookingTicket(token, booking, secret, options = {}) {
  const verified = verifySignedTicket(token, secret, options.nowSeconds);
  if (!verified.ok) return verified;
  if (verified.bookingId !== booking.id) return { ok: false, code: 'BOOKING_MISMATCH' };
  if (!booking.qr_token_hash || !constantTimeStringEqual(sha256Hex(token), String(booking.qr_token_hash))) {
    return { ok: false, code: 'TICKET_REVOKED' };
  }
  return verified;
}
