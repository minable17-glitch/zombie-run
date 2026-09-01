const EARTH_RADIUS_M = 6371000

function toRad(deg) {
  return (deg * Math.PI) / 180
}

function toDeg(rad) {
  return (rad * 180) / Math.PI
}

// 두 좌표 사이의 실제 거리(미터) — Haversine 공식
export function haversineDistance(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(Math.min(1, a)))
}

// 좌표1에서 좌표2를 바라보는 방위각(도, 0=북쪽)
export function bearingTo(lat1, lon1, lat2, lon2) {
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2))
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1))
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

// 좌표에서 특정 방위각으로 distanceMeters만큼 떨어진 좌표를 계산
export function destinationPoint(lat, lon, distanceMeters, bearingDeg) {
  const angDist = distanceMeters / EARTH_RADIUS_M
  const brng = toRad(bearingDeg)
  const lat1 = toRad(lat)
  const lon1 = toRad(lon)
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angDist) + Math.cos(lat1) * Math.sin(angDist) * Math.cos(brng)
  )
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(angDist) * Math.cos(lat1),
      Math.cos(angDist) - Math.sin(lat1) * Math.sin(lat2)
    )
  return { lat: toDeg(lat2), lon: ((toDeg(lon2) + 540) % 360) - 180 }
}

// 기준 좌표에서 minMeters~maxMeters 범위, 무작위 방향으로 떨어진 좌표 (좀비/아이템 스폰용)
export function randomPointNear(lat, lon, minMeters, maxMeters) {
  const dist = minMeters + Math.random() * (maxMeters - minMeters)
  const bearing = Math.random() * 360
  return destinationPoint(lat, lon, dist, bearing)
}

// 기준 좌표에서 minMeters~maxMeters 범위, centerBearingDeg를 중심으로 ±spreadDeg 안의 방향으로
// 떨어진 좌표 (플레이어가 달리는 방향 뒤/앞 쪽으로 좀비·아이템을 스폰시켜서, 도망치는 방향이
// "그냥 계속 달리던 방향으로" 하나로 정해지게 하기 위함)
export function randomPointInDirection(lat, lon, minMeters, maxMeters, centerBearingDeg, spreadDeg) {
  const dist = minMeters + Math.random() * (maxMeters - minMeters)
  const bearing = centerBearingDeg + (Math.random() * 2 - 1) * spreadDeg
  return destinationPoint(lat, lon, dist, bearing)
}

// from에서 to를 향해 stepMeters만큼 다가간 좌표 (좀비 추격 이동용)
export function moveToward(fromLat, fromLon, toLat, toLon, stepMeters) {
  const dist = haversineDistance(fromLat, fromLon, toLat, toLon)
  if (dist <= stepMeters || dist === 0) return { lat: toLat, lon: toLon }
  const brng = bearingTo(fromLat, fromLon, toLat, toLon)
  return destinationPoint(fromLat, fromLon, stepMeters, brng)
}

// point가 center에서 radiusMeters보다 멀면, 그 방향으로 radius 안쪽(90%)까지 당겨서 반환
// (제한구역 모드에서 좀비/아이템 스폰 지점이 항상 경계 안에 있도록 묶어둠)
export function clampToRadius(point, center, radiusMeters) {
  const dist = haversineDistance(center.lat, center.lon, point.lat, point.lon)
  if (dist <= radiusMeters) return point
  const brng = bearingTo(center.lat, center.lon, point.lat, point.lon)
  return destinationPoint(center.lat, center.lon, radiusMeters * 0.9, brng)
}

// {lat,lon} 배열로 된 경로를 distanceMeters만큼 따라 이동.
// 새 위치와, 그 지점부터 남은 경로(먼저 지나온 구간은 잘라낸)를 반환 (도로 경로를 따라가는 좀비 이동용)
export function advanceAlongPath(path, distanceMeters) {
  let remaining = distanceMeters
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]
    const b = path[i + 1]
    const segDist = haversineDistance(a.lat, a.lon, b.lat, b.lon)
    if (segDist >= remaining) {
      const t = segDist === 0 ? 0 : remaining / segDist
      const pos = { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t }
      return { pos, path: [pos, ...path.slice(i + 1)] }
    }
    remaining -= segDist
  }
  const last = path[path.length - 1]
  return { pos: last, path: [last] }
}
