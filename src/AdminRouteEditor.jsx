import { useCallback, useEffect, useState } from 'react'
import AdminMap from './AdminMap.jsx'
import { haversineDistance } from './lib/geo.js'

const DEFAULT_RADIUS_M = 400

// 관리자가 특정 장소에 좀비가 다닐 경로를 미리 그려서, 그 결과 JSON을
// src/data/zombieMaps.json에 붙여넣을 수 있게 만들어주는 화면. 서버 없이
// 코드에 직접 커밋하는 방식이라 별도 백엔드가 필요 없음.
export default function AdminRouteEditor({ onBack }) {
  const [center, setCenter] = useState(null)
  const [geoError, setGeoError] = useState('')
  const [mapName, setMapName] = useState('')
  const [radius, setRadius] = useState(DEFAULT_RADIUS_M)
  const [routes, setRoutes] = useState([])
  const [currentRoute, setCurrentRoute] = useState([])
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setGeoError('이 기기/브라우저는 위치 정보를 지원하지 않아요.')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setCenter({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) => setGeoError(err.message || '위치 권한이 필요해요.'),
      { enableHighAccuracy: true, timeout: 20000 }
    )
  }, [])

  const handleMapClick = useCallback((point) => {
    setCurrentRoute((prev) => [...prev, point])
  }, [])

  const undoPoint = () => setCurrentRoute((prev) => prev.slice(0, -1))

  const finishRoute = () => {
    if (currentRoute.length < 2) return
    setRoutes((prev) => [...prev, currentRoute])
    setCurrentRoute([])
  }

  const removeRoute = (idx) => setRoutes((prev) => prev.filter((_, i) => i !== idx))

  const clearAll = () => {
    setRoutes([])
    setCurrentRoute([])
  }

  const buildMapData = () => {
    const allRoutes = currentRoute.length >= 2 ? [...routes, currentRoute] : routes
    return {
      id: (mapName.trim() || 'map') + '_' + Date.now(),
      name: mapName.trim() || '이름 없는 지도',
      center,
      radius,
      routes: allRoutes,
    }
  }

  const copyJson = async () => {
    const json = JSON.stringify(buildMapData(), null, 2)
    try {
      await navigator.clipboard.writeText(json)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  const totalRoutes = routes.length + (currentRoute.length >= 2 ? 1 : 0)
  const jsonPreview = center ? JSON.stringify(buildMapData(), null, 2) : ''

  return (
    <div className="zr-screen">
      <div className="zr-hud-top zr-admin-top">
        <div>
          <div className="zr-hud-label">관리자: 좀비 경로 만들기</div>
          <div className="zr-hud-value" style={{ fontSize: 13 }}>
            지도를 탭해서 경로를 그려주세요
          </div>
        </div>
        <button className="zr-round-btn" onClick={onBack}>
          ←
        </button>
      </div>

      {geoError && (
        <div className="zr-screen zr-start">
          <div className="zr-start-card">
            <p className="zr-error">{geoError}</p>
            <button className="zr-btn zr-btn-ghost" onClick={onBack}>
              돌아가기
            </button>
          </div>
        </div>
      )}

      {!geoError && !center && (
        <div className="zr-screen zr-start">
          <div className="zr-start-card">
            <p className="zr-subtitle">위치를 확인하는 중…</p>
          </div>
        </div>
      )}

      {center && (
        <>
          <AdminMap center={center} routes={routes} currentRoute={currentRoute} onMapClick={handleMapClick} />

          <div className="zr-admin-panel">
            <input
              className="zr-admin-input"
              placeholder="지도 이름 (예: 우리 동네 공원)"
              value={mapName}
              onChange={(e) => setMapName(e.target.value)}
            />
            <div className="zr-admin-row">
              <span className="zr-pace-label" style={{ margin: 0 }}>
                플레이 반경 {radius}m
              </span>
              <input
                type="range"
                min="100"
                max="1500"
                step="50"
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
              />
            </div>
            <div className="zr-admin-row">
              <button className="zr-btn zr-btn-ghost zr-btn-small" onClick={undoPoint} disabled={!currentRoute.length}>
                점 취소
              </button>
              <button className="zr-btn zr-btn-ghost zr-btn-small" onClick={finishRoute} disabled={currentRoute.length < 2}>
                이 경로 완료 ({currentRoute.length}점)
              </button>
              <button className="zr-btn zr-btn-ghost zr-btn-small" onClick={clearAll} disabled={!routes.length && !currentRoute.length}>
                전체 초기화
              </button>
            </div>
            <p className="zr-pace-hint" style={{ margin: '4px 0' }}>
              완성된 경로 {routes.length}개{totalRoutes !== routes.length ? ' (+ 지금 그리는 중 1개)' : ''} — 경로마다 좀비 1마리가
              그 위를 왔다갔다 순찰해요.
            </p>
            <button className="zr-btn zr-btn-primary" onClick={copyJson} disabled={totalRoutes === 0}>
              {copied ? '복사됨! ✅' : 'JSON 복사하기'}
            </button>
            {jsonPreview && <textarea className="zr-admin-json" readOnly value={jsonPreview} />}
            <p className="zr-pace-hint">
              복사한 내용을 <code>src/data/zombieMaps.json</code> 배열 안에 붙여넣고 커밋하면, 이 위치 근처에서
              게임을 시작할 때 자동으로 이 경로가 적용돼요.
            </p>
          </div>
        </>
      )}
    </div>
  )
}
