const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validCalendarDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function resolveDateRange(fromValue, toValue, now = new Date(), maxDays = 366) {
  const today = now.toISOString().slice(0, 10);
  const fallbackTo = toValue || today;
  const to = fallbackTo;
  let from = fromValue;
  if (!from) {
    const start = new Date(`${to}T00:00:00.000Z`);
    if (!validCalendarDate(to)) throw new Error('Dates must use the YYYY-MM-DD format and be valid calendar dates.');
    start.setUTCDate(start.getUTCDate() - 29);
    from = start.toISOString().slice(0, 10);
  }
  if (!validCalendarDate(from) || !validCalendarDate(to)) {
    throw new Error('Dates must use the YYYY-MM-DD format and be valid calendar dates.');
  }
  const startMs = Date.parse(`${from}T00:00:00.000Z`);
  const endMs = Date.parse(`${to}T00:00:00.000Z`);
  if (startMs > endMs) throw new Error('The start date must be on or before the end date.');
  const days = Math.floor((endMs - startMs) / 86_400_000) + 1;
  if (days > maxDays) throw new Error(`Choose a date range of ${maxDays} days or less.`);
  return { from, to, days };
}

export function normalizeStatusFilter(value) {
  if (value == null || value === '' || value === 'all') return null;
  if (!['open', 'acknowledged', 'resolved'].includes(value)) {
    throw new Error('Alert status must be open, acknowledged, resolved, or all.');
  }
  return value;
}

export function normalizeRevenueRows(rows = []) {
  return rows.map((row) => ({
    date: (typeof row.report_date === 'string' && DATE_RE.test(row.report_date))
      ? row.report_date
      : new Date(row.report_date).toISOString().slice(0, 10),
    currency: String(row.currency || 'INR').toUpperCase(),
    amount: Number(row.amount || 0),
    paymentCount: Number(row.payment_count || 0)
  }));
}
