import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// CARTO 다크 타일은 이제 API 키가 있어야 해서(무료 익명 사용 중단), 대신 키가 필요 없는
// 기본 OSM 타일을 그대로 쓰고 CSS 필터로 어둡게 반전시킴 (index.css의 .zr-map 규칙 참고)
const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

function iconHtml(kind, className = '') {
  if (kind === 'player') return `<div class="zr-marker zr-marker-player ${className}">
    <span class="zr-marker-aura"></span><svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="9" r="6"/><path d="M18 18h12l4 12-5 1 4 13h-6l-3-11-3 11h-6l4-13-5-1 4-12Z"/><path d="m18 22-8 8m20-8 8 8"/></svg>
  </div>`
  if (kind === 'zombie') return `<div class="zr-marker zr-marker-zombie ${className}">
    <span class="zr-marker-threat-ring"></span><span class="zr-zombie-label">추격</span><svg viewBox="0 0 48 48" aria-hidden="true"><path d="M10 39V19c0-8 6-13 14-13s14 5 14 13v20l-5-3-4 4-5-4-5 4-4-4-5 3Z"/><circle cx="18" cy="23" r="3"/><circle cx="30" cy="23" r="3"/><path d="M17 32c4 3 10 3 14 0"/></svg>
  </div>`
  return `<div class="zr-marker zr-marker-pickup ${className}"><span class="zr-pickup-glow"></span><svg viewBox="0 0 48 48" aria-hidden="true"><path d="M15 7h18M15 41h18M18 8c0 8 12 8 12 16s-12 8-12 16M30 8c0 8-12 8-12 16s12 8 12 16"/><path d="M18 14h12M18 34h12"/></svg></div>`
}

// 지도는 마운트될 때 한 번만 만들고, 이후에는 플레이어/좀비/아이템 마커만
// leaflet을 직접 조작해서 갱신함 (React 리렌더마다 지도를 새로 만들면 깜빡이고 무거워짐)
export default function GameMap({ playerPos, zombies, pickups, follow, areaCenter, areaRadius }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const playerMarkerRef = useRef(null)
  const zombieMarkersRef = useRef(new Map())
  const pickupMarkersRef = useRef(new Map())
  const areaCircleRef = useRef(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: true,
    }).setView([37.5665, 126.978], 17)
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTR }).addTo(map)
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      playerMarkerRef.current = null
      areaCircleRef.current = null
      zombieMarkersRef.current.clear()
      pickupMarkersRef.current.clear()
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !playerPos) return
    if (!playerMarkerRef.current) {
      const icon = L.divIcon({
        html: iconHtml('player'),
        className: '',
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      })
      playerMarkerRef.current = L.marker([playerPos.lat, playerPos.lon], {
        icon,
        zIndexOffset: 1000,
      }).addTo(map)
      map.setView([playerPos.lat, playerPos.lon], 17)
    } else {
      playerMarkerRef.current.setLatLng([playerPos.lat, playerPos.lon])
      if (follow) map.panTo([playerPos.lat, playerPos.lon], { animate: true })
    }
  }, [playerPos, follow])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const seen = new Set()
    for (const z of zombies) {
      seen.add(z.id)
      let marker = zombieMarkersRef.current.get(z.id)
      if (!marker) {
        const icon = L.divIcon({
          html: iconHtml('zombie', z.state === 'chase' ? 'zr-zombie-chase' : 'zr-zombie-patrol'),
          className: '',
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        })
        marker = L.marker([z.lat, z.lon], { icon }).addTo(map)
        marker._zrClass = z.state === 'chase' ? 'zr-zombie-chase' : 'zr-zombie-patrol'
        zombieMarkersRef.current.set(z.id, marker)
      } else {
        marker.setLatLng([z.lat, z.lon])
        const nextClass = z.state === 'chase' ? 'zr-zombie-chase' : 'zr-zombie-patrol'
        if (marker._zrClass !== nextClass) {
          marker.setIcon(L.divIcon({
            html: iconHtml('zombie', nextClass), className: '', iconSize: [52, 52], iconAnchor: [26, 26],
          }))
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
    const seen = new Set()
    for (const p of pickups) {
      seen.add(p.id)
      if (pickupMarkersRef.current.has(p.id)) continue
      const icon = L.divIcon({
        html: iconHtml('pickup', `zr-marker-${p.type}`),
        className: '',
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      })
      const marker = L.marker([p.lat, p.lon], { icon }).addTo(map)
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
          color: '#ef5350',
          weight: 2,
          fillColor: '#ef5350',
          fillOpacity: 0.06,
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

  return <div ref={containerRef} className="zr-map" />
}
