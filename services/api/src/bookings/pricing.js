const RATE_UNITS_PER_MINUTE = Object.freeze({
  hourly: 60,
  daily: 60 * 24,
  weekly: 60 * 24 * 7,
  monthly: 60 * 24 * 30
});

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function toMysqlUtc(dateValue) {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid date value.');
  return date.toISOString().slice(0, 19).replace('T', ' ');
}


function dateTimeInZone(date, timeZone) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const weekdayNames = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekdayText = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date);
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minute: Number(values.hour) * 60 + Number(values.minute),
    weekday: weekdayNames[weekdayText]
  };
}

function timeToMinutes(value) {
  if (value === null || value === undefined || value === '') return null;
  const match = String(value).match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Start and end times must fall within configured local access hours. A vehicle
 * may remain parked while the facility is closed between those two times; this
 * permits legitimate daily/weekly/monthly reservations.
 */
export function isWithinOperatingHours(startValue, endValue, openingValue, closingValue, timeZone = 'UTC') {
  if (!openingValue || !closingValue) return true; // Unset schedule means no schedule restriction.
  const open = timeToMinutes(openingValue);
  const close = timeToMinutes(closingValue);
  if (open === null || close === null) return false;
  if (open === close) return true; // Equal opening/closing means 24-hour operation.

  try {
    const start = dateTimeInZone(new Date(startValue), timeZone);
    const end = dateTimeInZone(new Date(endValue), timeZone);
    const startInside = open < close
      ? start.minute >= open && start.minute < close
      : start.minute >= open || start.minute < close;
    const endInside = open < close
      ? end.minute >= open && end.minute <= close
      : end.minute >= open || end.minute <= close;
    return startInside && endInside;
  } catch {
    return false;
  }
}

/**
 * Validates a shared-space booking against the host's weekly access schedule.
 * Start must be within the day's open interval; end may be exactly at closing.
 * For multi-day bookings, the start and end are checked against their own local
 * calendar days. The vehicle may remain parked while access is closed between.
 * Missing or incomplete schedules fail closed for marketplace listings.
 */
export function isWithinWeeklyAvailability(startValue, endValue, rules, timeZone = 'UTC') {
  if (!Array.isArray(rules) || rules.length !== 7) return false;
  const byDay = new Map(rules.map((rule) => [Number(rule.weekday), rule]));
  if (byDay.size !== 7) return false;

  try {
    const startDate = new Date(startValue);
    const endDate = new Date(endValue);
    if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime()) || endDate <= startDate) return false;
    const start = dateTimeInZone(startDate, timeZone);
    const end = dateTimeInZone(endDate, timeZone);

    const isInside = (point, isEnd) => {
      const rule = byDay.get(point.weekday);
      if (!rule || !(rule.is_available === true || rule.is_available === 1 || rule.is_available === '1' || rule.isAvailable === true)) return false;
      const opensAt = timeToMinutes(rule.opens_at ?? rule.opensAt);
      const closesAt = timeToMinutes(rule.closes_at ?? rule.closesAt);
      if (opensAt === null || closesAt === null || closesAt <= opensAt) return false;
      return isEnd
        ? point.minute >= opensAt && point.minute <= closesAt
        : point.minute >= opensAt && point.minute < closesAt;
    };

    return isInside(start, false) && isInside(end, true);
  } catch {
    return false;
  }
}

export function validateBookingInterval(startValue, endValue, nowMs = Date.now()) {
  const start = new Date(startValue);
  const end = new Date(endValue);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return { ok: false, code: 'INVALID_DATE', message: 'Enter a valid start and end date/time.' };
  }
  if (start.getTime() < nowMs + 60_000) {
    return { ok: false, code: 'START_IN_PAST', message: 'The booking must start at least one minute from now.' };
  }
  if (end.getTime() <= start.getTime()) {
    return { ok: false, code: 'INVALID_INTERVAL', message: 'The end time must be later than the start time.' };
  }
  const durationMinutes = Math.ceil((end.getTime() - start.getTime()) / 60_000);
  if (durationMinutes < 30) {
    return { ok: false, code: 'MINIMUM_DURATION', message: 'The minimum booking duration is 30 minutes.' };
  }
  if (durationMinutes > 30 * 24 * 60) {
    return { ok: false, code: 'MAXIMUM_DURATION', message: 'A single booking cannot exceed 30 days.' };
  }
  return { ok: true, start, end, durationMinutes };
}

/**
 * Selects the lowest total cost among the active rate types returned by the
 * database. Slot-specific rules must be ordered before lot-wide rules.
 * A booking has one service fee and tax is applied to base amount + service fee.
 */
export function calculateBestQuote(rateRows, durationMinutes, quoteTime = new Date()) {
  const seen = new Set();
  const usableRows = [];
  for (const row of rateRows ?? []) {
    if (!RATE_UNITS_PER_MINUTE[row.rate_type] || seen.has(row.rate_type)) continue;
    const amount = Number(row.amount);
    const serviceFee = Number(row.service_fee ?? 0);
    const taxRate = Number(row.tax_rate_percent ?? 0);
    if (![amount, serviceFee, taxRate].every(Number.isFinite) || amount < 0 || serviceFee < 0 || taxRate < 0 || taxRate > 100) continue;
    seen.add(row.rate_type);
    usableRows.push({ ...row, amount, serviceFee, taxRate });
  }
  if (!usableRows.length) return null;

  const candidates = usableRows.map((row) => {
    const units = Math.max(1, Math.ceil(durationMinutes / RATE_UNITS_PER_MINUTE[row.rate_type]));
    const baseAmount = roundMoney(row.amount * units);
    const serviceFee = roundMoney(row.serviceFee);
    const taxAmount = roundMoney((baseAmount + serviceFee) * row.taxRate / 100);
    return {
      currency: row.currency || 'INR',
      rateType: row.rate_type,
      pricingRuleId: row.id,
      units,
      unitAmount: roundMoney(row.amount),
      durationMinutes,
      baseAmount,
      serviceFee,
      taxRatePercent: row.taxRate,
      taxAmount,
      discountAmount: 0,
      totalAmount: roundMoney(baseAmount + serviceFee + taxAmount),
      quoteGeneratedAt: quoteTime.toISOString()
    };
  });

  candidates.sort((a, b) => a.totalAmount - b.totalAmount ||
    RATE_UNITS_PER_MINUTE[a.rateType] - RATE_UNITS_PER_MINUTE[b.rateType]);
  return candidates[0];
}

export function isoOrNull(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : String(value);
}

export function mapBookingRow(row) {
  return {
    id: row.id,
    bookingCode: row.booking_code,
    userId: row.user_id,
    parkingLotId: row.parking_lot_id,
    parkingLotName: row.parking_lot_name ?? null,
    city: row.city ?? null,
    slotId: row.slot_id,
    slotCode: row.slot_code ?? null,
    vehicleId: row.vehicle_id ?? null,
    vehicleRegistration: row.registration_number ?? null,
    startAt: isoOrNull(row.start_at),
    endAt: isoOrNull(row.end_at),
    status: row.status,
    holdExpiresAt: isoOrNull(row.hold_expires_at),
    currency: row.currency,
    baseAmount: Number(row.base_amount),
    serviceFee: Number(row.service_fee),
    taxAmount: Number(row.tax_amount),
    discountAmount: Number(row.discount_amount),
    totalAmount: Number(row.total_amount),
    pricingSnapshot: typeof row.pricing_snapshot === 'string' ? JSON.parse(row.pricing_snapshot) : row.pricing_snapshot,
    createdAt: isoOrNull(row.created_at)
  };
}
