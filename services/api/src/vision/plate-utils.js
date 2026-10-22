export function normalizePlate(value) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function plateMatchStatus({ confidence, vehicleMatched, bookingMatched }) {
  if (confidence < 0.72) return 'review_required';
  if (bookingMatched) return 'matched_booking';
  if (vehicleMatched) return 'matched_vehicle';
  return 'unmatched';
}
