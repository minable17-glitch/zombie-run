import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// CARTO 다크 타일은 이제 API 키가 있어야 해서(무료 익명 사용 중단), 대신 키가 필요 없는
// 기본 OSM 타일을 그대로 쓰고 CSS 필터로 어둡게 반전시킴 (index.css의 .zr-map 규칙 참고)
const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
const MARKER_SIZE = { player: 42, zombie: 38, pickup: 34 }
const EMPTY_ROUTES = []

function iconHtml(kind, className = '', bearing = null) {
  if (kind === 'player') return `<div class="zr-marker zr-marker-player ${className}">
    <span class="zr-marker-aura"></span><span class="zr-player-bearing${Number.isFinite(bearing) ? '' : ' zr-bearing-unknown'}" style="--zr-bearing:${Number.isFinite(bearing) ? bearing : 0}deg"><svg viewBox="0 0 48 48" aria-hidden="true"><path d="m24 7 12 31-12-7-12 7Z"/></svg></span>
  </div>`
  if (kind === 'zombie') return `<div class="zr-marker zr-marker-zombie ${className}">
    <span class="zr-marker-threat-ring"></span><svg viewBox="0 0 48 48" aria-hidden="true"><path d="M12 33v-5a14 14 0 1 1 24 0v5l-5 3v5l-5-3-2 3-2-3-5 3v-5Z"/><circle cx="19" cy="24" r="3"/><circle cx="29" cy="24" r="3"/><path d="m19 32 3-2 2 2 2-2 3 2"/></svg>
  </div>`
  return `<div class="zr-marker zr-marker-pickup ${className}"><span class="zr-pickup-glow"></span><svg viewBox="0 0 48 48" aria-hidden="true"><path d="M15 7h18M15 41h18M18 8c0 8 12 8 12 16s-12 8-12 16M30 8c0 8-12 8-12 16s12 8 12 16"/><path d="M18 14h12M18 34h12"/></svg></div>`
}

function leafletIcon(kind, className = '', bearing = null) {
  const size = MARKER_SIZE[kind]
  return L.divIcon({
    html: iconHtml(kind, className, bearing),
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

// 지도는 마운트될 때 한 번만 만들고, 이후에는 플레이어/좀비/아이템 마커만
// leaflet을 직접 조작해서 갱신함 (React 리렌더마다 지도를 새로 만들면 깜빡이고 무거워짐)
export default function GameMap({ playerPos, zombies, pickups, follow, areaCenter, areaRadius, headingDeg, trailDistance = 0, trackingPaused = false, patrolRoutes = EMPTY_ROUTES }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const playerMarkerRef = useRef(null)
  const zombieMarkersRef = useRef(new Map())
  const pickupMarkersRef = useRef(new Map())
  const areaCircleRef = useRef(null)
  const playerTrailRef = useRef(null)
  const playerTrailSegmentsRef = useRef([])
  const lastTrailDistanceRef = useRef(0)
  const trailBreakRef = useRef(false)
  const patrolRouteLayersRef = useRef([])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: true,
      preferCanvas: true,
    }).setView([37.5665, 126.978], 17)
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTR }).addTo(map)
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      playerMarkerRef.current = null
      areaCircleRef.current = null
      playerTrailRef.current = null
      playerTrailSegmentsRef.current = []
      lastTrailDistanceRef.current = 0
      trailBreakRef.current = false
      patrolRouteLayersRef.current = []
      zombieMarkersRef.current.clear()
      pickupMarkersRef.current.clear()
    }
  }, [])

  useEffect(() => {
    if (trackingPaused) trailBreakRef.current = true
  }, [trackingPaused])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !playerPos) return
    if (!playerMarkerRef.current) {
      const icon = leafletIcon('player', '', headingDeg)
      playerMarkerRef.current = L.marker([playerPos.lat, playerPos.lon], {
        icon,
        zIndexOffset: 1000,
        keyboard: false,
        interactive: false,
      }).addTo(map)
      map.setView([playerPos.lat, playerPos.lon], 17)
    } else {
      playerMarkerRef.current.setLatLng([playerPos.lat, playerPos.lon])
      const bearingEl = playerMarkerRef.current.getElement()?.querySelector('.zr-player-bearing')
      bearingEl?.style.setProperty('--zr-bearing', `${Number.isFinite(headingDeg) ? headingDeg : 0}deg`)
      bearingEl?.classList.toggle('zr-bearing-unknown', !Number.isFinite(headingDeg))
      if (follow) {
        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        map.panTo([playerPos.lat, playerPos.lon], { animate: !reduceMotion })
      }
    }
    const nextPoint = L.latLng(playerPos.lat, playerPos.lon)
    const segments = playerTrailSegmentsRef.current
    const lastPoint = segments.at(-1)?.at(-1)
    const distanceIncreased = trailDistance > lastTrailDistanceRef.current
    if (lastPoint && !distanceIncreased && lastPoint.distanceTo(nextPoint) > 20) trailBreakRef.current = true
    if (!lastPoint || (distanceIncreased && lastPoint.distanceTo(nextPoint) >= 1.5)) {
      if (!lastPoint || trailBreakRef.current) {
        segments.push([nextPoint])
        trailBreakRef.current = false
      } else {
        segments.at(-1).push(nextPoint)
      }
      while (segments.reduce((count, segment) => count + segment.length, 0) > 160) {
        segments[0].shift()
        if (!segments[0].length) segments.shift()
      }
      if (!playerTrailRef.current) {
        playerTrailRef.current = L.polyline(segments, {
          color: '#45ddff', weight: 4, opacity: 0.9, lineCap: 'round',
        }).addTo(map)
      } else {
        playerTrailRef.current.setLatLngs(segments)
      }
    }
    lastTrailDistanceRef.current = trailDistance
  }, [playerPos, follow, headingDeg, trailDistance])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const seen = new Set()
    for (const z of zombies) {
      seen.add(z.id)
      let marker = zombieMarkersRef.current.get(z.id)
      if (!marker) {
        const icon = leafletIcon('zombie', z.patrolRoute && z.state !== 'chase' ? 'zr-zombie-patrol' : 'zr-zombie-chase')
        marker = L.marker([z.lat, z.lon], { icon, keyboard: false, interactive: false }).addTo(map)
        marker._zrClass = z.patrolRoute && z.state !== 'chase' ? 'zr-zombie-patrol' : 'zr-zombie-chase'
        zombieMarkersRef.current.set(z.id, marker)
      } else {
        marker.setLatLng([z.lat, z.lon])
        const nextClass = z.patrolRoute && z.state !== 'chase' ? 'zr-zombie-patrol' : 'zr-zombie-chase'
        if (marker._zrClass !== nextClass) {
          marker.setIcon(leafletIcon('zombie', nextClass))
          marker._zrClass = nextClass
        }
      }
    }
    for (const [id, marker] of zombieMarkersRef.current) {
      if (!seen.has(id)) {
        map.removeLayer(marker)
        zombieMarkersRef.current.delete(id)
      }
    }
  }, [zombies])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const routes = patrolRoutes.filter((route) => Array.isArray(route) && route.length > 1)
    patrolRouteLayersRef.current.forEach((layer) => map.removeLayer(layer))
    patrolRouteLayersRef.current = routes.map((route) => L.polyline(
      route.map((p) => [p.lat, p.lon]),
      { color: '#ff5a57', weight: 2.5, opacity: 0.72, dashArray: '7 8', lineCap: 'round' }
    ).addTo(map))
  }, [patrolRoutes])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const seen = new Set()
    for (const p of pickups) {
      seen.add(p.id)
      if (pickupMarkersRef.current.has(p.id)) continue
      const icon = leafletIcon('pickup', `zr-marker-${p.type}`)
      const marker = L.marker([p.lat, p.lon], { icon, keyboard: false, interactive: false }).addTo(map)
      pickupMarkersRef.current.set(p.id, marker)
    }
    for (const [id, marker] of pickupMarkersRef.current) {
      if (!seen.has(id)) {
        map.removeLayer(marker)
        pickupMarkersRef.current.delete(id)
      }
    }
  }, [pickups])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (areaCenter && areaRadius) {
      if (!areaCircleRef.current) {
        areaCircleRef.current = L.circle([areaCenter.lat, areaCenter.lon], {
          radius: areaRadius,
          color: '#ff6863',
          weight: 2,
          dashArray: '8 9',
          fillColor: '#ff6863',
          fillOpacity: 0.025,
        }).addTo(map)
      } else {
        areaCircleRef.current.setLatLng([areaCenter.lat, areaCenter.lon])
        areaCircleRef.current.setRadius(areaRadius)
      }
    } else if (areaCircleRef.current) {
      map.removeLayer(areaCircleRef.current)
      areaCircleRef.current = null
    }
  }, [areaCenter, areaRadius])

  return <div ref={containerRef} className="zr-map" role="region" aria-label="게임 지도" />
}
