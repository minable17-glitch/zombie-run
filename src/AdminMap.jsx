import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// GameMap과 동일: 키가 필요 없는 OSM 타일을 CSS 필터로 어둡게 반전시켜 씀 (index.css 참고)
const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
const ROUTE_COLORS = ['#ef5350', '#42a5f5', '#66bb6a', '#ffca28', '#ab47bc', '#26c6da']

// 관리자가 지도를 탭해서 좀비 경로(좌표 배열)를 그리는 화면.
// GameMap과 달리 지도 클릭을 받아 점을 추가하고, 완성된 경로들 + 지금 그리는 중인 경로를 선으로 표시함
export default function AdminMap({ center, radius, routes, currentRoute, onMapClick, boundary = null, editingArea = false, drawMode = 'points', onBoundaryChange }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const centerMarkerRef = useRef(null)
  const areaCircleRef = useRef(null)
  const routeLayersRef = useRef([])
  const currentLayersRef = useRef([])
  const boundaryLayersRef = useRef([])
  const boundaryChangeRef = useRef(onBoundaryChange)
  boundaryChangeRef.current = onBoundaryChange
  const boundaryRef = useRef(boundary)
  boundaryRef.current = boundary
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
      interactive: false, keyboard: false,
      icon: L.divIcon({ html: '<div class="zr-marker">🏁</div>', className: '', iconSize: [30, 30], iconAnchor: [15, 15] }),
    }).addTo(map)
    return () => {
      map.remove()
      mapRef.current = null
      centerMarkerRef.current = null
      areaCircleRef.current = null
      routeLayersRef.current = []
      currentLayersRef.current = []
      boundaryLayersRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !center) return
    if (boundary !== null || !Number.isFinite(radius)) {
      if (areaCircleRef.current) map.removeLayer(areaCircleRef.current)
      areaCircleRef.current = null
      centerMarkerRef.current?.setOpacity(boundary !== null ? 0 : 1)
      return
    }
    centerMarkerRef.current?.setOpacity(1)
    if (!areaCircleRef.current) {
      areaCircleRef.current = L.circle([center.lat, center.lon], {
        radius,
        color: '#ef5350',
        weight: 2,
        fillColor: '#ef5350',
        fillOpacity: 0.06,
        interactive: false,
      }).addTo(map)
    } else {
      areaCircleRef.current.setLatLng([center.lat, center.lon])
      areaCircleRef.current.setRadius(radius)
    }
    centerMarkerRef.current?.setLatLng([center.lat, center.lon])
  }, [center, radius, boundary])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    boundaryLayersRef.current.forEach(layer => map.removeLayer(layer))
    boundaryLayersRef.current = []
    if (!boundary?.length) return
    const points = boundary.map(p => [p.lat, p.lon])
    if (boundary.length > 1) boundaryLayersRef.current.push(
      (boundary.length >= 3 ? L.polygon : L.polyline)(points, {
        color: '#45ddff', weight: 3, fillOpacity: 0.12, interactive: false,
      }).addTo(map))
    if (editingArea && drawMode !== 'draw') boundary.forEach((p, index) => {
      const marker = L.marker([p.lat, p.lon], {
        draggable: true, title: `구역 점 ${index + 1}`, bubblingMouseEvents: false,
        icon: L.divIcon({ html: `<div class="zr-point-marker zr-area-point">${index + 1}</div>`, className: '', iconSize: [32, 32], iconAnchor: [16, 16] }),
      }).addTo(map)
      marker.on('dragend', () => {
        const point = marker.getLatLng()
        boundaryChangeRef.current?.(boundary.map((old, i) => i === index ? { lat: point.lat, lon: point.lng } : old))
      })
      boundaryLayersRef.current.push(marker)
    })
  }, [boundary, editingArea, drawMode])

  useEffect(() => {
    const map = mapRef.current, container = containerRef.current
    if (!map || !container || !editingArea || boundary === null || drawMode !== 'draw') return
    const handlers = [map.dragging, map.touchZoom, map.boxZoom, map.scrollWheelZoom]
    const enabled = handlers.map(handler => handler.enabled())
    handlers.forEach(handler => handler.disable())
    let pointer = null, points = [], lastPixel = null, previous = boundary
    const addPoint = event => {
      const pixel = map.mouseEventToContainerPoint(event)
      if (lastPixel && pixel.distanceTo(lastPixel) < 6) return
      if (points.length >= 200) return
      const point = map.containerPointToLatLng(pixel)
      points.push({ lat: point.lat, lon: point.lng })
      lastPixel = pixel
      boundaryChangeRef.current?.([...points])
    }
    const stop = event => { event.preventDefault(); event.stopImmediatePropagation() }
    const down = event => {
      if (pointer !== null || event.button > 0 || event.target.closest('.leaflet-control')) return
      stop(event)
      pointer = event.pointerId
      previous = boundaryRef.current
      points = []; lastPixel = null
      container.setPointerCapture(pointer)
      addPoint(event)
    }
    const move = event => { if (event.pointerId === pointer) { stop(event); addPoint(event) } }
    const up = event => {
      if (event.pointerId !== pointer) return
      stop(event)
      if (event.type === 'pointercancel') boundaryChangeRef.current?.(previous)
      else {
        addPoint(event)
        if (points.length > 3 && map.latLngToContainerPoint([points[0].lat, points[0].lon]).distanceTo(lastPixel) < 8) points.pop()
        boundaryChangeRef.current?.([...points])
        previous = [...points]
      }
      container.releasePointerCapture(pointer)
      pointer = null
    }
    const click = event => { if (!event.target.closest('.leaflet-control')) stop(event) }
    const listeners = { pointerdown: down, pointermove: move, pointerup: up, pointercancel: up, click }
    Object.entries(listeners).forEach(([type, handler]) => container.addEventListener(type, handler, true))
    return () => {
      Object.entries(listeners).forEach(([type, handler]) => container.removeEventListener(type, handler, true))
      if (pointer !== null && container.hasPointerCapture(pointer)) container.releasePointerCapture(pointer)
      handlers.forEach((handler, i) => { if (enabled[i]) handler.enable() })
    }
    // Keep pointer capture alive while the in-progress boundary rerenders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingArea, drawMode, boundary === null])

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
      currentRoute.forEach((p, i) => {
        currentLayersRef.current.push(
          L.marker([p.lat, p.lon], {
            icon: L.divIcon({
              html: `<div class="zr-point-marker">${i + 1}</div>`,
              className: '',
              iconSize: [20, 20],
              iconAnchor: [10, 10],
            }),
          }).addTo(map)
        )
      })
    }
  }, [currentRoute])

  return <div ref={containerRef} className={`zr-map zr-editor-map${editingArea && boundary !== null && drawMode === 'draw' ? ' zr-area-drawing' : ''}`} role="region" aria-label="구역 편집 지도" />
}
