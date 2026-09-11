import { haversineDistance } from './geo.js'

export const HIT_GRACE_MS = 5000
export const GPS_STALE_MS = 15000
export const MAX_GPS_ACCURACY_M = 30

export function readFix(position, now = Date.now()) {
  const { latitude: lat, longitude: lon, accuracy } = position.coords
  const t = position.timestamp
  if (![lat, lon, accuracy, t].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(lon) > 180 ||
      accuracy < 0 || accuracy > MAX_GPS_ACCURACY_M || now - t > GPS_STALE_MS || t > now + 1000) return null
  return { lat, lon, accuracy, t }
}

export function measureMovement(previous, next) {
  if (!previous) return 0
  const dt = (next.t - previous.t) / 1000
  if (dt <= 0 || dt > GPS_STALE_MS / 1000) return 0
  const distance = haversineDistance(previous.lat, previous.lon, next.lat, next.lon)
  if (distance < Math.max(3, Math.min(10, (previous.accuracy + next.accuracy) / 4))) return 0
  return distance / dt <= 10 ? distance : 0
}

export function validZombieMap(row) {
  return Number.isFinite(row.center_lat) && Math.abs(row.center_lat) <= 90 &&
    Number.isFinite(row.center_lon) && Math.abs(row.center_lon) <= 180 &&
    Number.isFinite(row.radius_m) && row.radius_m >= 50 && row.radius_m <= 5000 &&
    Array.isArray(row.routes) && row.routes.length <= 50 && row.routes.every(route =>
      Array.isArray(route) && route.length >= 2 && route.length <= 1000 && route.every(p =>
        Number.isFinite(p.lat) && Math.abs(p.lat) <= 90 && Number.isFinite(p.lon) && Math.abs(p.lon) <= 180))
}
