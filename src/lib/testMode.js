export const TEST_CENTER = { lat: 37.5665, lon: 126.978 }

// Deliberately limited to local development hosts. A query string on the
// deployed site can never enable this mode.
export function isLocalTestMode(locationLike = globalThis.location) {
  if (!locationLike) return false
  const localHost = locationLike.hostname === 'localhost' || locationLike.hostname === '127.0.0.1'
  return localHost && new URLSearchParams(locationLike.search || '').get('test') === '1'
}

export function makeTestPosition(timestamp = Date.now(), step = 0, center = TEST_CENTER) {
  return {
    timestamp,
    coords: {
      latitude: center.lat + step * 0.00002,
      longitude: center.lon + step * 0.000015,
      accuracy: 5,
    },
  }
}
