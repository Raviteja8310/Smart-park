export function buildBookingDemandForecast({ historicalRows = [], capacity = 0, now = new Date(), hours = 24, sampleWeeks = 8 } = {}) {
  const patterns = new Map();
  for (const row of historicalRows) {
    const key = `${Number(row.weekday)}:${Number(row.hour)}`;
    patterns.set(key, {
      starts: Number(row.booking_count ?? 0),
      sampledDays: Number(row.sampled_days ?? 0)
    });
  }
  const totalCapacity = Math.max(0, Number(capacity) || 0);
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours() + 1, 0, 0, 0));
  return Array.from({ length: Math.min(168, Math.max(1, Number(hours) || 24)) }, (_, index) => {
    const date = new Date(start.getTime() + index * 60 * 60 * 1000);
    const weekday = date.getUTCDay() + 1; // MySQL DAYOFWEEK: Sunday=1
    const bucket = patterns.get(`${weekday}:${date.getUTCHours()}`) ?? { starts: 0, sampledDays: 0 };
    const expectedStarts = Math.round((bucket.starts / Math.max(1, sampleWeeks)) * 100) / 100;
    const pressure = totalCapacity ? Math.min(100, Math.round((expectedStarts / totalCapacity) * 1000) / 10) : 0;
    const confidence = bucket.sampledDays >= 6 ? 'medium' : bucket.sampledDays >= 3 ? 'low-medium' : 'low';
    return { hourAt: date.toISOString(), expectedBookingStarts: expectedStarts, capacity: totalCapacity,
      bookingDemandPercentOfCapacity: pressure, historicDaysWithStarts: bucket.sampledDays, confidence };
  });
}
