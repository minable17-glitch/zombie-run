import { useCallback, useEffect, useState } from 'react'
import AdminMap from './AdminMap.jsx'
import { supabase, supabaseProjectRef } from './lib/supabaseClient.js'
import { clampToRadius, formatDistance, haversineDistance, pathLength } from './lib/geo.js'
import { mapNameError, normalizeMapName, rowToZombieMap } from './lib/zombieMaps.js'
import { useBackableStep } from './lib/useBackableStep.js'
import { isLocalTestMode, TEST_CENTER } from './lib/testMode.js'
import { validPoint, polygonError, polygonBounds, insidePolygon, segmentInside } from './lib/playArea.js'

const DEFAULT_RADIUS_M = 400

// 로그인한 사용자가 특정 장소에 좀비가 다닐 경로를 미리 그려서, 그대로 Supabase에 저장하는 화면.
// 1) 구역(중심+반경)을 먼저 확정하고 2) 그 구역 안에서만 경로를 그리는 2단계 흐름.
// 내가 만든 지도만 목록에서 불러와 수정하거나 삭제할 수 있음(다른 사람이 만든 지도는 게임에서
// 쓸 수만 있고 여기서 편집은 못 함).
export default function AdminRouteEditor({ onBack, onSaved, onLogout, session }) {
  const userId = session?.user?.id ?? null
  const [step, setStep] = useBackableStep('area', 'zr-editor') // 'area' | 'routes'
  const [center, setCenter] = useState(null)
  const [geoError, setGeoError] = useState('')
  const [mapName, setMapName] = useState('')
  const [radius, setRadius] = useState(DEFAULT_RADIUS_M)
  const [areaPickMode, setAreaPickMode] = useState('center')
  const [areaShape, setAreaShape] = useState('polygon')
  const [boundary, setBoundary] = useState([])
  const [drawMode, setDrawMode] = useState('points')
  const [routes, setRoutes] = useState([])
  const [currentRoute, setCurrentRoute] = useState([])
  const [editingMapId, setEditingMapId] = useState(null)
  const [savedMaps, setSavedMaps] = useState([])
  const [savedMapsError, setSavedMapsError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (isLocalTestMode()) {
      setCenter(TEST_CENTER)
      return
    }
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
      let query = supabase.from('zombie_maps').select('*').order('created_at', { ascending: false })
      // 로그인한 사용자에게는 본인이 만든 지도만 보여줌 — 수정/삭제도 본인 것만 가능하기 때문
      if (userId) query = query.eq('owner_id', userId)
      const { data, error } = await query
      if (error) {
        setSavedMapsError(error.message)
        return
      }
      setSavedMapsError('')
      setSavedMaps((data || []).map(rowToZombieMap))
    } catch (e) {
      setSavedMapsError(e?.message || '저장된 지도를 불러오지 못했어요.')
    }
  }, [userId])

  useEffect(() => {
    refreshSavedMaps()
  }, [refreshSavedMaps])

  const handleMapClick = useCallback(
    (point) => {
      if (!center || !validPoint(point)) return
      if (step === 'area') {
        if (areaShape === 'polygon') {
          if (drawMode === 'points') setBoundary(prev => prev.length < 200 ? [...prev, point] : prev)
          setSaveError('')
          return
        }
        if (areaPickMode === 'center') {
          setCenter(point)
          setAreaPickMode('radius')
        } else {
          const distance = haversineDistance(center.lat, center.lon, point.lat, point.lon)
          if (Number.isFinite(distance)) setRadius(Math.round(Math.min(1500, Math.max(100, distance))))
        }
        setSaveError('')
        return
      }
      if (areaShape === 'polygon' && (!insidePolygon(point, boundary) ||
        (currentRoute.length && !segmentInside(currentRoute.at(-1), point, boundary)))) {
        setSaveError('경로가 구역 밖으로 나가요. 테두리 안쪽을 따라 점을 찍어주세요.')
        return
      }
      const clamped = areaShape === 'polygon' ? point : clampToRadius(point, center, radius)
      setSaveError('')
      setCurrentRoute((prev) => [...prev, clamped])
    },
    [step, center, radius, areaPickMode, areaShape, boundary, drawMode, currentRoute]
  )

  const undoPoint = () => setCurrentRoute((prev) => prev.slice(0, -1))
  const cancelCurrentRoute = () => setCurrentRoute([])

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
    setAreaPickMode('center')
    setAreaShape('polygon')
    setBoundary([])
    setDrawMode('points')
    setRoutes([])
    setCurrentRoute([])
    setStep('area')
  }

  const loadMap = (map) => {
    setEditingMapId(map.id)
    setMapName(map.name)
    setCenter(map.center)
    setRadius(map.radius)
    setAreaPickMode('radius')
    setAreaShape(map.boundary ? 'polygon' : 'circle')
    setBoundary(map.boundary || [])
    setDrawMode('points')
    setRoutes(map.routes)
    setCurrentRoute([])
    setStep('routes')
  }

  const deleteMap = async (id) => {
    if (!supabase) return
    if (!window.confirm('이 지도를 삭제할까요? 되돌릴 수 없어요.')) return
    try {
      // .select()를 붙여서 실제로 지워진 행을 돌려받음 — Supabase 삭제 권한(정책)이
      // 없으면 에러 없이 그냥 0건이 지워지고 조용히 "성공"으로 응답하기 때문에,
      // error만 확인해서는 이 경우를 못 잡음(그래서 예전엔 삭제가 안 되는데도 티가 안 났음)
      const { data, error } = await supabase.from('zombie_maps').delete().eq('id', id).select()
      if (error) {
        setSavedMapsError(error.message || '삭제에 실패했어요.')
        return
      }
      if (!data || data.length === 0) {
        setSavedMapsError(
          '삭제가 안 됐어요. Supabase에 삭제 권한(정책)이 설정 안 됐을 수 있어요 — supabase/schema.sql을 SQL Editor에서 다시 실행해보세요.'
        )
        return
      }
    } catch (e) {
      setSavedMapsError(e?.message || '삭제에 실패했어요.')
      return
    }
    if (editingMapId === id) startNewMap()
    refreshSavedMaps()
    onSaved?.()
  }

  const confirmArea = () => {
    const error = mapNameError(mapName, savedMaps, editingMapId) || (areaShape === 'polygon' && polygonError(boundary))
    if (error) {
      setSaveError(error)
      return
    }
    setMapName(normalizeMapName(mapName))
    if (areaShape === 'polygon') {
      const bounds = polygonBounds(boundary)
      setCenter(bounds.center)
      setRadius(bounds.radius)
    }
    setSaveError('')
    setStep('routes')
  }

  const totalRoutes = routes.length + (currentRoute.length >= 2 ? 1 : 0)

  const saveMap = async () => {
    if (!supabase) {
      setSaveError('저장소가 아직 연결 안 됐어요 (관리자에게 Supabase 설정을 문의하세요).')
      return
    }
    const allRoutes = currentRoute.length >= 2 ? [...routes, currentRoute] : routes
    const nameError = mapNameError(mapName, savedMaps, editingMapId)
    if (nameError) {
      setSaveError(nameError)
      return
    }
    if (areaShape === 'polygon') {
      const error = polygonError(boundary)
      if (error) { setSaveError(error); return }
      if (allRoutes.some(route => route.some((p, i) => !insidePolygon(p, boundary) || (i > 0 && !segmentInside(route[i - 1], p, boundary))))) {
        setSaveError('변경한 구역 밖에 기존 경로가 있어요. 해당 경로를 지우고 다시 그려주세요.')
        return
      }
    }
    // 새 지도는 경로가 하나는 있어야 저장 의미가 있지만, 기존 지도를 수정하는 중이면
    // 경로를 전부 지우고(초기화) 빈 채로 저장(= 이 위치의 좀비를 없앰)하는 것도 허용함
    if ((allRoutes.length === 0 && !editingMapId) || !center) return
    setSaving(true)
    setSaveError('')
    const payload = {
      name: normalizeMapName(mapName),
      center_lat: center.lat,
      center_lon: center.lon,
      radius_m: radius,
      routes: allRoutes,
      boundary: areaShape === 'polygon' ? boundary : null,
      ...(userId ? { owner_id: userId } : {}),
    }
    let error = null
    try {
      const result = editingMapId
        ? await supabase.from('zombie_maps').update(payload).eq('id', editingMapId).select('id').single()
        : await supabase.from('zombie_maps').insert(payload).select('id').single()
      error = result.error
      if (!error && !editingMapId) setEditingMapId(result.data.id)
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
          <div className="zr-hud-label">내 좀비 경로 만들기{session?.user?.user_metadata?.username ? ' · ' + session.user.user_metadata.username : ''}</div>
          <div className="zr-hud-value" style={{ fontSize: 13 }}>
            {step === 'area' ? '플레이 구역의 테두리를 그려주세요' : '지도를 탭해서 경로를 그려주세요'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {onLogout && (
            <button className="zr-round-btn" style={{ fontSize: 16 }} onClick={onLogout} title="로그아웃">
              🔓
            </button>
          )}
          <button className="zr-round-btn" onClick={() => (step === 'routes' ? setStep('area') : onBack())}>
            ←
          </button>
        </div>
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
          <AdminMap center={center} radius={radius} routes={routes} currentRoute={currentRoute} onMapClick={handleMapClick}
            boundary={areaShape === 'polygon' ? boundary : null} editingArea={step === 'area'} drawMode={drawMode}
            onBoundaryChange={points => { setBoundary(points); setSaveError('') }} />

          <div className="zr-admin-panel">
            {step === 'area' ? (
              <>
                <input
                  className="zr-admin-input"
                  placeholder="지도 이름 (예: 우리 동네 공원)" aria-label="지도 이름" maxLength={100}
                  value={mapName}
                  onChange={(e) => { setMapName(e.target.value); setSaveError('') }}
                />
                {saveError && <p role="alert" className="zr-error">{saveError}</p>}
                <div className="zr-area-tools" role="group" aria-label="구역 모양">
                  <button className="zr-btn zr-btn-ghost" aria-pressed={areaShape === 'polygon'} onClick={() => { setAreaShape('polygon'); setSaveError('') }}>자유 구역</button>
                  <button className="zr-btn zr-btn-ghost" aria-pressed={areaShape === 'circle'} onClick={() => { setAreaShape('circle'); setAreaPickMode('center'); setSaveError('') }}>원형 구역</button>
                </div>
                {areaShape === 'polygon' ? <>
                  <div className="zr-area-tools" role="group" aria-label="구역 그리기 도구">
                    {[['points', '점 찍기'], ['draw', '드래그 그리기'], ['move', '지도 이동']].map(([value, label]) =>
                      <button key={value} className="zr-btn zr-btn-ghost" aria-pressed={drawMode === value} onClick={() => setDrawMode(value)}>{label}</button>)}
                  </div>
                  <p className="zr-pace-hint">{drawMode === 'draw' ? '지도를 누른 채 테두리를 그리세요. 손을 놓으면 닫힙니다. 다시 그리면 현재 구역을 교체합니다.' : drawMode === 'move' ? '지도를 드래그해 이동하세요. 그리려면 점 찍기나 드래그 그리기를 선택하세요.' : '테두리를 따라 순서대로 점을 찍으세요. 3점부터 구역이 닫힙니다. 번호가 있는 점은 끌어서 옮길 수 있어요.'}</p>
                  <div className="zr-area-tools">
                    <span aria-live="polite">테두리 {boundary.length}/200점</span>
                    <button className="zr-btn zr-btn-ghost" disabled={!boundary.length} onClick={() => { setBoundary(prev => prev.slice(0, -1)); setSaveError('') }}>구역 점 취소</button>
                    <button className="zr-btn zr-btn-ghost" disabled={!boundary.length} onClick={() => { setBoundary([]); setSaveError('') }}>구역 초기화</button>
                  </div>
                </> : <>
                <div className="zr-admin-row">
                  <span className="zr-pace-label" style={{ margin: 0 }}>
                    플레이 반경 {radius}m
                  </span>
                  {areaPickMode === 'radius' && <button className="zr-btn zr-btn-ghost zr-btn-small" onClick={() => setAreaPickMode('center')}>중심 다시 선택</button>}
                </div>
                <p className="zr-pace-hint" style={{ margin: '4px 0' }}>
                  {areaPickMode === 'center'
                    ? '1단계 · 지도의 원하는 중심을 눌러주세요. 현재 위치를 기준으로 시작하려면 빨간 중심을 그대로 두고 한 번 눌러주세요.'
                    : '2단계 · 중심에서 원하는 가장자리를 한 번 더 눌러 반경을 정하세요. 빨간 원이 실제 플레이 구역입니다.'}
                </p>
                </>}
                <button className="zr-btn zr-btn-primary" onClick={confirmArea}>
                  구역 확정하고 경로 그리기 →
                </button>

                {supabaseProjectRef && (
                  <p className="zr-pace-hint" style={{ marginTop: 14, opacity: 0.55 }}>
                    연결된 저장소: {supabaseProjectRef} (Supabase에서 SQL을 실행할 땐 이 ID와 같은
                    프로젝트인지 꼭 확인하세요 — Settings → API → Project ID)
                  </p>
                )}
                {savedMapsError && <p className="zr-error">{savedMapsError}</p>}
                {savedMaps.length > 0 && (
                  <>
                    <p className="zr-pace-label" style={{ marginTop: 14 }}>
                      내가 만든 지도
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
                  <button
                    className="zr-btn zr-btn-ghost zr-btn-small"
                    onClick={cancelCurrentRoute}
                    disabled={!currentRoute.length}
                  >
                    이 경로 취소
                  </button>
                  <button className="zr-btn zr-btn-ghost zr-btn-small" onClick={finishRoute} disabled={currentRoute.length < 2}>
                    이 경로 완료 ({currentRoute.length}점)
                  </button>
                  <button className="zr-btn zr-btn-ghost zr-btn-small" onClick={clearAll} disabled={!routes.length && !currentRoute.length}>
                    경로 전체 초기화
                  </button>
                </div>
                {currentRoute.length >= 2 && (
                  <p className="zr-pace-hint" style={{ margin: '0 0 10px' }}>
                    📏 지금 그리는 경로 거리: <strong>{formatDistance(pathLength(currentRoute))}</strong> (
                    {currentRoute.length}점) — 잘못 찍었으면 "점 취소"로 마지막 점만, "이 경로 취소"로 지금
                    그리는 경로를 통째로 지울 수 있어요.
                  </p>
                )}
                {routes.length > 0 && (
                  <div className="zr-admin-route-list">
                    {routes.map((route, i) => (
                      <span key={i} className="zr-admin-route-chip">
                        경로 {i + 1} ({formatDistance(pathLength(route))})
                        <button onClick={() => removeRoute(i)}>✕</button>
                      </span>
                    ))}
                  </div>
                )}
                <p className="zr-pace-hint" style={{ margin: '4px 0' }}>
                  완성된 경로 {routes.length}개{totalRoutes !== routes.length ? ' (+ 지금 그리는 중 1개)' : ''} — 경로마다 좀비
                  1마리가 그 위를 왔다갔다 순찰해요. 구역 테두리 안쪽을 따라 경로를 그려주세요.
                </p>
                {saveError && <p role="alert" className="zr-error">{saveError}</p>}
                <button
                  className="zr-btn zr-btn-primary"
                  onClick={saveMap}
                  disabled={(totalRoutes === 0 && !editingMapId) || saving || Boolean(mapNameError(mapName, savedMaps, editingMapId))}
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
                  저장 후 그룹 방에서 이 지도를 선택하면 지정된 구역과 경로로 플레이해요.
                </p>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
