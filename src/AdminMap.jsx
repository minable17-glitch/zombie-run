import { useEffect, useRef } from 'react'
import L from 'leaflet'

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
const ROUTE_COLORS = ['#ef5350', '#42a5f5', '#66bb6a', '#ffca28', '#ab47bc', '#26c6da']

// 관리자가 지도를 탭해서 좀비 경로(좌표 배열)를 그리는 화면.
// GameMap과 달리 지도 클릭을 받아 점을 추가하고, 완성된 경로들 + 지금 그리는 중인 경로를 선으로 표시함
export default function AdminMap({ center, radius, routes, currentRoute, onMapClick }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const centerMarkerRef = useRef(null)
  const areaCircleRef = useRef(null)
  const routeLayersRef = useRef([])
  const currentLayersRef = useRef([])
  const onMapClickRef = useRef(onMapClick)
  onMapClickRef.current = onMapClick

  useEffect(() => {
    if (!containerRef.current || mapRef.current || !center) return
    const map = L.map(containerRef.current, { zoomControl: true, doubleClickZoom: false }).setView(
      [center.lat, center.lon],
      17
    )
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTR }).addTo(map)
    map.on('click', (e) => onMapClickRef.current({ lat: e.latlng.lat, lon: e.latlng.lng }))
    mapRef.current = map
    centerMarkerRef.current = L.marker([center.lat, center.lon], {
      icon: L.divIcon({ html: '<div class="zr-marker">🏁</div>', className: '', iconSize: [30, 30], iconAnchor: [15, 15] }),
    }).addTo(map)
    return () => {
      map.remove()
      mapRef.current = null
      centerMarkerRef.current = null
      areaCircleRef.current = null
      routeLayersRef.current = []
      currentLayersRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !center) return
    if (!areaCircleRef.current) {
      areaCircleRef.current = L.circle([center.lat, center.lon], {
        radius,
        color: '#ef5350',
        weight: 2,
        fillColor: '#ef5350',
        fillOpacity: 0.06,
      }).addTo(map)
    } else {
      areaCircleRef.current.setLatLng([center.lat, center.lon])
      areaCircleRef.current.setRadius(radius)
    }
  }, [center, radius])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    for (const layer of routeLayersRef.current) map.removeLayer(layer)
    routeLayersRef.current = routes.map((route, i) =>
      L.polyline(
        route.map((p) => [p.lat, p.lon]),
        { color: ROUTE_COLORS[i % ROUTE_COLORS.length], weight: 4, opacity: 0.85 }
      ).addTo(map)
    )
  }, [routes])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    for (const layer of currentLayersRef.current) map.removeLayer(layer)
    currentLayersRef.current = []
    if (currentRoute.length > 0) {
      currentLayersRef.current.push(
        L.polyline(
          currentRoute.map((p) => [p.lat, p.lon]),
          { color: '#fff', weight: 3, dashArray: '6 6' }
        ).addTo(map)
      )
      for (const p of currentRoute) {
        currentLayersRef.current.push(
          L.circleMarker([p.lat, p.lon], { radius: 4, color: '#fff', fillColor: '#fff', fillOpacity: 1 }).addTo(map)
        )
      }
    }
  }, [currentRoute])

  return <div ref={containerRef} className="zr-map" />
}
