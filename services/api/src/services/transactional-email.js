const TEMPLATE_FIELDS = Object.freeze({
  booking_hold_created: {
    subject: 'Your SmartPark reservation hold',
    required: ['bookingCode', 'lotName', 'slotCode', 'startAt', 'endAt', 'holdMinutes']
  },
  booking_cancelled: {
    subject: 'Your SmartPark reservation was cancelled',
    required: ['bookingCode', 'lotName', 'slotCode']
  },
  booking_confirmed: {
    subject: 'Your SmartPark booking is confirmed',
    required: ['bookingCode', 'lotName', 'slotCode', 'startAt', 'endAt', 'amount', 'currency']
  },
  parking_entry_recorded: {
    subject: 'SmartPark entry recorded',
    required: ['bookingCode', 'lotName', 'slotCode']
  },
  parking_exit_recorded: {
    subject: 'SmartPark parking session completed',
    required: ['bookingCode', 'lotName', 'slotCode']
  }
});

const FIELD_LIMITS = Object.freeze({
  bookingCode: 40,
  lotName: 160,
  slotCode: 30,
  startAt: 64,
  endAt: 64,
  holdMinutes: 3,
  amount: 24,
  currency: 3
});

export const EMAIL_TEMPLATE_KEYS = Object.freeze(Object.keys(TEMPLATE_FIELDS));

export function normalizeEmailTemplateData(templateKey, data) {
  const template = TEMPLATE_FIELDS[templateKey];
  if (!template) throw new Error('Unsupported transactional email template.');
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Email template data must be an object.');

  const normalized = {};
  for (const key of template.required) {
    const raw = data[key];
    if (raw === undefined || raw === null || String(raw).trim() === '') throw new Error(`Missing required email field: ${key}`);
    const value = String(raw).trim();
    const limit = FIELD_LIMITS[key] ?? 160;
    if (value.length > limit) throw new Error(`Email field ${key} is too long.`);
    normalized[key] = value;
  }
  if (template.required.includes('currency') && !/^[A-Z]{3}$/.test(normalized.currency)) {
    throw new Error('Email currency must be a three-letter uppercase code.');
  }
  if (template.required.includes('amount') && (!/^\d{1,10}(?:\.\d{1,2})?$/.test(normalized.amount) || Number(normalized.amount) < 0)) {
    throw new Error('Email amount is invalid.');
  }
  if (template.required.includes('holdMinutes') && (!/^\d{1,3}$/.test(normalized.holdMinutes) || Number(normalized.holdMinutes) < 1)) {
    throw new Error('Email hold duration is invalid.');
  }
  return normalized;
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function frame(title, body) {
  return `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#20312b;max-width:620px;margin:0 auto"><h2>${escapeHtml(title)}</h2>${body}<hr style="border:0;border-top:1px solid #dce5e0;margin:24px 0"><p style="font-size:12px;color:#64736d">This is an automated SmartPark message. Do not reply with payment details or passwords.</p></div>`;
}

function detailLines(data) {
  const lines = [
    ['Booking reference', data.bookingCode],
    ['Parking facility', data.lotName],
    ['Parking space', data.slotCode]
  ];
  if (data.startAt) lines.push(['Starts', data.startAt]);
  if (data.endAt) lines.push(['Ends', data.endAt]);
  if (data.amount !== undefined) lines.push(['Amount paid', `${data.currency} ${data.amount}`]);
  return `<ul>${lines.map(([label, value]) => `<li><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</li>`).join('')}</ul>`;
}

export function renderTransactionalEmail(templateKey, rawData) {
  const data = normalizeEmailTemplateData(templateKey, rawData);
  const definition = TEMPLATE_FIELDS[templateKey];
  let lead = '';
  let note = '';
  switch (templateKey) {
    case 'booking_hold_created':
      lead = `We have temporarily held your parking space for ${escapeHtml(data.holdMinutes)} minutes.`;
      note = 'This is not a confirmed or paid booking. Complete checkout before the hold expires.';
      break;
    case 'booking_cancelled':
      lead = 'Your unpaid reservation hold has been cancelled.';
      note = 'No payment was captured by this cancellation action. If you believe a payment was captured, contact support.';
      break;
    case 'booking_confirmed':
      lead = 'Your payment was verified and your reservation is confirmed.';
      note = 'Open SmartPark to view your QR parking ticket. Entry is still subject to the facility and ticket rules.';
      break;
    case 'parking_entry_recorded':
      lead = 'Your parking entry has been recorded by the facility.';
      note = 'Keep your booking details available until your parking session is complete.';
      break;
    case 'parking_exit_recorded':
      lead = 'Your parking session has been marked complete.';
      note = 'Please review your transaction history for the final recorded session details.';
      break;
    default:
      throw new Error('Unsupported transactional email template.');
  }
  const body = `<p>${lead}</p>${detailLines(data)}<p>${escapeHtml(note)}</p>`;
  const textLines = [definition.subject, lead.replace(/<[^>]*>/g, ''), ...[
    `Booking reference: ${data.bookingCode}`,
    `Parking facility: ${data.lotName}`,
    `Parking space: ${data.slotCode}`,
    ...(data.startAt ? [`Starts: ${data.startAt}`] : []),
    ...(data.endAt ? [`Ends: ${data.endAt}`] : []),
    ...(data.amount !== undefined ? [`Amount paid: ${data.currency} ${data.amount}`] : [])
  ], note, 'This is an automated SmartPark message. Do not reply with payment details or passwords.'];
  return {
    subject: definition.subject,
    text: textLines.join('\n'),
    html: frame(definition.subject, body)
  };
}

export function retryDelaySeconds(attemptNumber) {
  const attempt = Number(attemptNumber);
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error('Attempt number must be a positive integer.');
  return Math.min(3600, 30 * (2 ** Math.min(attempt - 1, 10)));
}
