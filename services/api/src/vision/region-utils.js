export function normalizePolygon(points) {
  if (!Array.isArray(points) || points.length < 3 || points.length > 16) {
    throw new Error('A parking-space region needs between 3 and 16 points.');
  }
  const normalized = points.map((point) => {
    if (!Array.isArray(point) || point.length !== 2) throw new Error('Each point must be an [x, y] pair.');
    const [x, y] = point;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
      throw new Error('Region coordinates must be numbers between 0 and 1.');
    }
    return [Number(x.toFixed(6)), Number(y.toFixed(6))];
  });
  const unique = new Set(normalized.map(([x, y]) => `${x}:${y}`));
  if (unique.size < 3) throw new Error('A region needs at least three distinct points.');
  let twiceArea = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    const [x1, y1] = normalized[i];
    const [x2, y2] = normalized[(i + 1) % normalized.length];
    twiceArea += x1 * y2 - x2 * y1;
  }
  if (Math.abs(twiceArea) < 0.000001) throw new Error('Region points must form a polygon with non-zero area.');
  return normalized;
}

export function safeJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
