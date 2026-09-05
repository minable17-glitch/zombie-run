import { useCallback, useEffect, useState } from 'react'
import AdminMap from './AdminMap.jsx'
import { supabase } from './lib/supabaseClient.js'
import { clampToRadius } from './lib/geo.js'

const DEFAULT_RADIUS_M = 400

function rowToMap(row) {
  return {
    id: row.id,
    name: row.name,
    center: { lat: row.center_lat, lon: row.center_lon },
    radius: row.radius_m,
    routes: row.routes,
  }
}

// 관리자가 특정 장소에 좀비가 다닐 경로를 미리 그려서, 그대로 Supabase에 저장하는 화면.
// 1) 구역(중심+반경)을 먼저 확정하고 2) 그 구역 안에서만 경로를 그리는 2단계 흐름.
// 저장된 지도를 목록에서 불러와 수정하거나 삭제할 수도 있음.
export default function AdminRouteEditor({ onBack, onSaved }) {
  const [step, setStep] = useState('area') // 'area' | 'routes'
  const [center, setCenter] = useState(null)
  const [geoError, setGeoError] = useState('')
  const [mapName, setMapName] = useState('')
  const [radius, setRadius] = useState(DEFAULT_RADIUS_M)
  const [routes, setRoutes] = useState([])
  const [currentRoute, setCurrentRoute] = useState([])
  const [editingMapId, setEditingMapId] = useState(null)
  const [savedMaps, setSavedMaps] = useState([])
  const [savedMapsError, setSavedMapsError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saved, setSaved] = useState(false)

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

  const refreshSavedMaps = useCallback(async () => {
    if (!supabase) return
    try {
      const { data, error } = await supabase.from('zombie_maps').select('*').order('created_at', { ascending: false })
      if (error) {
        setSavedMapsError(error.message)
        return
      }
      setSavedMapsError('')
      setSavedMaps((data || []).map(rowToMap))
    } catch (e) {
      setSavedMapsError(e?.message || '저장된 지도를 불러오지 못했어요.')
    }
  }, [])

  useEffect(() => {
    refreshSavedMaps()
  }, [refreshSavedMaps])

  const handleMapClick = useCallback(
    (point) => {
      if (step !== 'routes' || !center) return
      const clamped = clampToRadius(point, center, radius)
      setCurrentRoute((prev) => [...prev, clamped])
    },
    [step, center, radius]
  )

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

  const startNewMap = () => {
    setEditingMapId(null)
    setMapName('')
    setRadius(DEFAULT_RADIUS_M)
    setRoutes([])
    setCurrentRoute([])
    setStep('area')
  }

  const loadMap = (map) => {
    setEditingMapId(map.id)
    setMapName(map.name)
    setCenter(map.center)
    setRadius(map.radius)
    setRoutes(map.routes)
    setCurrentRoute([])
    setStep('routes')
  }

  const deleteMap = async (id) => {
    if (!supabase) return
    try {
      await supabase.from('zombie_maps').delete().eq('id', id)
    } catch {
      // 무시하고 목록은 다시 불러와서 실제 상태를 보여줌
    }
    if (editingMapId === id) startNewMap()
    refreshSavedMaps()
  }

  const confirmArea = () => setStep('routes')

  const totalRoutes = routes.length + (currentRoute.length >= 2 ? 1 : 0)

  const saveMap = async () => {
    if (!supabase) {
      setSaveError('저장소가 아직 연결 안 됐어요 (관리자에게 Supabase 설정을 문의하세요).')
      return
    }
    const allRoutes = currentRoute.length >= 2 ? [...routes, currentRoute] : routes
    // 새 지도는 경로가 하나는 있어야 저장 의미가 있지만, 기존 지도를 수정하는 중이면
    // 경로를 전부 지우고(초기화) 빈 채로 저장(= 이 위치의 좀비를 없앰)하는 것도 허용함
    if ((allRoutes.length === 0 && !editingMapId) || !center) return
    setSaving(true)
    setSaveError('')
    const payload = {
      name: mapName.trim() || '이름 없는 지도',
      center_lat: center.lat,
      center_lon: center.lon,
      radius_m: radius,
      routes: allRoutes,
    }
    let error = null
    try {
      const result = editingMapId
        ? await supabase.from('zombie_maps').update(payload).eq('id', editingMapId)
        : await supabase.from('zombie_maps').insert(payload)
      error = result.error
    } catch (e) {
      error = e
    }
    setSaving(false)
    if (error) {
      setSaveError(error.message || '저장에 실패했어요.')
      return
    }
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
    refreshSavedMaps()
    onSaved?.()
  }

  return (
    <div className="zr-screen">
      <div className="zr-hud-top zr-admin-top">
        <div>
          <div className="zr-hud-label">관리자: 좀비 경로 만들기</div>
          <div className="zr-hud-value" style={{ fontSize: 13 }}>
            {step === 'area' ? '구역(중심·반경)을 먼저 정해주세요' : '지도를 탭해서 경로를 그려주세요'}
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
          <AdminMap center={center} radius={radius} routes={routes} currentRoute={currentRoute} onMapClick={handleMapClick} />

          <div className="zr-admin-panel">
            {step === 'area' ? (
              <>
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
                <p className="zr-pace-hint" style={{ margin: '4px 0' }}>
                  빨간 원이 실제 플레이 구역이에요. 확정하면 이 안에서만 경로를 그릴 수 있어요.
                </p>
                <button className="zr-btn zr-btn-primary" onClick={confirmArea}>
                  구역 확정하고 경로 그리기 →
                </button>

                {savedMapsError && <p className="zr-error">{savedMapsError}</p>}
                {savedMaps.length > 0 && (
                  <>
                    <p className="zr-pace-label" style={{ marginTop: 14 }}>
                      저장된 지도
                    </p>
                    <div className="zr-admin-route-list">
                      {savedMaps.map((m) => (
                        <span key={m.id} className="zr-admin-route-chip">
                          {m.name} ({m.routes.length}경로)
                          <button onClick={() => loadMap(m)} title="불러오기">
                            ✏️
                          </button>
                          <button onClick={() => deleteMap(m.id)} title="삭제">
                            ✕
                          </button>
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </>
            ) : (
              <>
                <div className="zr-admin-row">
                  <button className="zr-btn zr-btn-ghost zr-btn-small" onClick={() => setStep('area')}>
                    ← 구역 다시 설정
                  </button>
                  <button className="zr-btn zr-btn-ghost zr-btn-small" onClick={startNewMap}>
                    새 지도 만들기
                  </button>
                </div>
                <div className="zr-admin-row">
                  <button className="zr-btn zr-btn-ghost zr-btn-small" onClick={undoPoint} disabled={!currentRoute.length}>
                    점 취소
                  </button>
                  <button className="zr-btn zr-btn-ghost zr-btn-small" onClick={finishRoute} disabled={currentRoute.length < 2}>
                    이 경로 완료 ({currentRoute.length}점)
                  </button>
                  <button className="zr-btn zr-btn-ghost zr-btn-small" onClick={clearAll} disabled={!routes.length && !currentRoute.length}>
                    경로 전체 초기화
                  </button>
                </div>
                {routes.length > 0 && (
                  <div className="zr-admin-route-list">
                    {routes.map((route, i) => (
                      <span key={i} className="zr-admin-route-chip">
                        경로 {i + 1} ({route.length}점)
                        <button onClick={() => removeRoute(i)}>✕</button>
                      </span>
                    ))}
                  </div>
                )}
                <p className="zr-pace-hint" style={{ margin: '4px 0' }}>
                  완성된 경로 {routes.length}개{totalRoutes !== routes.length ? ' (+ 지금 그리는 중 1개)' : ''} — 경로마다 좀비
                  1마리가 그 위를 왔다갔다 순찰해요. 구역 밖을 탭해도 자동으로 구역 안쪽으로 당겨져요.
                </p>
                {saveError && <p className="zr-error">{saveError}</p>}
                <button
                  className="zr-btn zr-btn-primary"
                  onClick={saveMap}
                  disabled={(totalRoutes === 0 && !editingMapId) || saving}
                >
                  {saving
                    ? '저장 중…'
                    : saved
                      ? '저장됨! ✅'
                      : editingMapId
                        ? totalRoutes === 0
                          ? '경로 비운 상태로 저장하기'
                          : '수정 저장하기'
                        : '이 지도 저장하기'}
                </button>
                <p className="zr-pace-hint">
                  저장하면 이 위치 반경 {radius}m 안에서 게임을 시작할 때 바로 이 경로가 적용돼요.
                </p>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
