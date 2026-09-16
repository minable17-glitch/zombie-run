import { haversineDistance } from './geo.js'

export const validPoint = p => p && Number.isFinite(p.lat) && Math.abs(p.lat) <= 90 && Number.isFinite(p.lon) && Math.abs(p.lon) <= 180
const cross = (a, b, c) => (b.lon - a.lon) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lon - a.lon)
const onSegment = (p, a, b) => Math.abs(cross(a, b, p)) < 1e-12 &&
  p.lon >= Math.min(a.lon, b.lon) - 1e-12 && p.lon <= Math.max(a.lon, b.lon) + 1e-12 &&
  p.lat >= Math.min(a.lat, b.lat) - 1e-12 && p.lat <= Math.max(a.lat, b.lat) + 1e-12

export function insidePolygon(point, polygon) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i]
    if (onSegment(point, a, b)) return true
    if ((a.lat > point.lat) !== (b.lat > point.lat) &&
      point.lon < (b.lon - a.lon) * (point.lat - a.lat) / (b.lat - a.lat) + a.lon) inside = !inside
  }
  return inside
}

export function polygonError(points) {
  if (!Array.isArray(points) || points.length < 3) return '구역 테두리에 점을 3개 이상 찍어주세요.'
  if (points.length > 200 || !points.every(validPoint)) return '구역은 유효한 점 200개 이내로 그려주세요.'
  let area = 0
  const origin = points[0]
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length]
    if (haversineDistance(a.lat, a.lon, b.lat, b.lon) < 0.5) return '서로 겹친 점을 취소하거나 옮겨주세요.'
    area += cross(origin, a, b)
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue
      const c = points[j], d = points[(j + 1) % points.length]
      if (onSegment(c, a, b) || onSegment(d, a, b) || onSegment(a, c, d) || onSegment(b, c, d) ||
        (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0))
        return '테두리가 서로 교차해요. 점을 취소하거나 옮겨주세요.'
    }
  }
  if (Math.abs(area) < 1e-9) return '너무 좁은 구역이에요. 테두리를 넓혀주세요.'
  if (polygonBounds(points).radius > 5000) return '구역 크기를 반경 5km 이내로 줄여주세요.'
  return ''
}

export function polygonBounds(points) {
  const center = {
    lat: (Math.min(...points.map(p => p.lat)) + Math.max(...points.map(p => p.lat))) / 2,
    lon: (Math.min(...points.map(p => p.lon)) + Math.max(...points.map(p => p.lon))) / 2,
  }
  return { center, radius: Math.max(50, Math.ceil(Math.max(...points.map(p => haversineDistance(center.lat, center.lon, p.lat, p.lon))))) }
}

export function insideArea(point, center, radius, boundary) {
  return boundary?.length >= 3 ? insidePolygon(point, boundary)
    : haversineDistance(center.lat, center.lon, point.lat, point.lon) <= radius
}

// Check the entire segment, including concave notches between two inside endpoints.
export function segmentInside(a, b, polygon) {
  if (!insidePolygon(a, polygon) || !insidePolygon(b, polygon)) return false
  const cuts = [0, 1]
  for (let i = 0; i < polygon.length; i++) {
    const c = polygon[i], d = polygon[(i + 1) % polygon.length]
    const dx = b.lon - a.lon, dy = b.lat - a.lat
    const ex = d.lon - c.lon, ey = d.lat - c.lat
    const denominator = dx * ey - dy * ex
    if (Math.abs(denominator) < 1e-15) {
      for (const p of [c, d]) if (onSegment(p, a, b)) cuts.push(Math.abs(dx) > Math.abs(dy) ? (p.lon - a.lon) / dx : dy ? (p.lat - a.lat) / dy : 0)
      continue
    }
    const t = ((c.lon - a.lon) * ey - (c.lat - a.lat) * ex) / denominator
    const u = ((c.lon - a.lon) * dy - (c.lat - a.lat) * dx) / denominator
    if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t)
  }
  cuts.sort((x, y) => x - y)
  return cuts.slice(1).every((t, i) => {
    const mid = (t + cuts[i]) / 2
    return insidePolygon({ lat: a.lat + (b.lat - a.lat) * mid, lon: a.lon + (b.lon - a.lon) * mid }, polygon)
  })
}
