export function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Physical occupancy and reservation state are intentionally independent.
 * A physically occupied slot remains occupied even if a booking also exists.
 */
export function deriveSlotState({ operationalStatus, physicalState, reservedNow }) {
  if (operationalStatus !== 'open') return operationalStatus;
  if (physicalState === 'occupied') return 'occupied';
  if (Boolean(reservedNow)) return 'reserved';
  if (physicalState !== 'empty') return 'unknown';
  return 'available';
}

export function isAvailableNow({ operationalStatus, physicalState, reservedNow }) {
  return operationalStatus === 'open' && physicalState === 'empty' && !Boolean(reservedNow);
}

export function mapLotRow(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    listingKind: row.listing_kind ?? 'facility',
    parkingType: row.parking_type ?? 'commercial',
    contactPhone: row.contact_phone ?? '',
    specialInstructions: row.special_instructions ?? '',
    amenities: (() => { try { return Array.isArray(row.amenities) ? row.amenities : JSON.parse(row.amenities ?? '[]'); } catch { return []; } })(),
    coverPhoto: row.cover_photo ?? null,
    addressLine: row.address_line,
    city: row.city,
    region: row.region ?? '',
    postalCode: row.postal_code ?? '',
    countryCode: row.country_code ?? '',
    latitude: row.latitude === null ? null : row.latitude === undefined ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : row.longitude === undefined ? null : Number(row.longitude),
    timezone: row.timezone,
    currency: row.currency,
    openingTime: row.opening_time ?? null,
    closingTime: row.closing_time ?? null,
    facilityStatus: row.facility_status,
    totalSpaces: toNumber(row.total_spaces),
    openSpaces: toNumber(row.open_spaces),
    availableNow: toNumber(row.available_now),
    occupiedNow: toNumber(row.occupied_now),
    reservedNow: toNumber(row.reserved_now),
    unknownSpaces: toNumber(row.unknown_spaces),
    hourlyRate: row.hourly_rate === null || row.hourly_rate === undefined ? null : Number(row.hourly_rate),
    averageRating: row.average_rating === null || row.average_rating === undefined ? null : Number(row.average_rating),
    reviewCount: toNumber(row.review_count),
    createdAt: row.created_at
  };
}
