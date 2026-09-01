const ORS_DIRECTIONS_URL = 'https://api.openrouteservice.org/v2/directions/foot-walking'

// ORS 무료 티어 레이트리밋(분당 40회)에 안전하게 걸리도록, 요청 사이에 최소 간격을 둠
const MIN_REQUEST_GAP_MS = 1700
let nextAvailableAt = 0

function reserveSlot() {
  const now = Date.now()
  const startAt = Math.max(now, nextAvailableAt)
  nextAvailableAt = startAt + MIN_REQUEST_GAP_MS
  return Math.max(0, startAt - now)
}

// from → to 사이의 실제 도보 경로를 좌표 배열([{lat,lon}, ...])로 가져옴.
// 키가 없거나, 요청이 실패하거나, 네트워크 문제가 있으면 null을 반환해서
// 호출하는 쪽이 직선 이동으로 자연스럽게 대체할 수 있게 함.
export async function fetchWalkingPath(apiKey, from, to) {
  if (!apiKey) return null
  const wait = reserveSlot()
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
  try {
    const res = await fetch(`${ORS_DIRECTIONS_URL}/geojson`, {
      method: 'POST',
      headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        coordinates: [
          [from.lon, from.lat],
          [to.lon, to.lat],
        ],
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    const coords = data?.features?.[0]?.geometry?.coordinates
    if (!Array.isArray(coords) || coords.length < 2) return null
    return coords.map(([lon, lat]) => ({ lat, lon }))
  } catch {
    return null
  }
}
