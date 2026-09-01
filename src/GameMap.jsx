import { useEffect, useRef } from 'react'
import L from 'leaflet'

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

function iconHtml(emoji, className) {
  return `<div class="zr-marker ${className}">${emoji}</div>`
}

// 지도는 마운트될 때 한 번만 만들고, 이후에는 플레이어/좀비/아이템 마커만
// leaflet을 직접 조작해서 갱신함 (React 리렌더마다 지도를 새로 만들면 깜빡이고 무거워짐)
export default function GameMap({ playerPos, zombies, pickups, onShootZombie, follow, areaCenter, areaRadius }) {
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
        html: iconHtml('🏃', 'zr-marker-player'),
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
          html: iconHtml('🧟', 'zr-marker-zombie'),
          className: '',
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        })
        marker = L.marker([z.lat, z.lon], { icon }).addTo(map)
        marker.on('click', () => onShootZombie(z.id))
        zombieMarkersRef.current.set(z.id, marker)
      } else {
        marker.setLatLng([z.lat, z.lon])
      }
    }
    for (const [id, marker] of zombieMarkersRef.current) {
      if (!seen.has(id)) {
        map.removeLayer(marker)
        zombieMarkersRef.current.delete(id)
      }
    }
  }, [zombies, onShootZombie])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const seen = new Set()
    for (const p of pickups) {
      seen.add(p.id)
      if (pickupMarkersRef.current.has(p.id)) continue
      const emoji = p.type === 'ammo' ? '📦' : '⏳'
      const icon = L.divIcon({
        html: iconHtml(emoji, `zr-marker-pickup zr-marker-${p.type}`),
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
