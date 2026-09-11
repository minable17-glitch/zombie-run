import { useCallback, useEffect, useRef, useState } from 'react'
import GameMap from './GameMap.jsx'
import AdminRouteEditor from './AdminRouteEditor.jsx'
import AuthScreen from './AuthScreen.jsx'
import ResetPassword from './ResetPassword.jsx'
import { formatDistance, haversineDistance } from './lib/geo.js'
import { fetchWalkingPath } from './lib/routing.js'
import { supabase } from './lib/supabaseClient.js'
import { AREA_RADIUS_PRESETS, DEFAULT_PACE_IDX, DEFAULT_RADIUS_IDX, PACE_PRESETS } from './lib/gameConfig.js'
import { fetchZombieMaps } from './lib/zombieMaps.js'
import { useBackableStep } from './lib/useBackableStep.js'
import RoomLobby from './RoomLobby.jsx'
import { ensureOwnProfile } from './lib/authHelpers.js'
import { accountLanding } from './lib/authLanding.js'
import { readRoom, updateRoomStat } from './lib/roomApi.js'
import { readFix, GPS_STALE_MS } from './lib/gameSafety.js'
import {
  makeInitialGame, applyStartSetup, advanceGame, updatePosition, findRouteCandidate,
  closestRouteIndex, formatTime, formatPace, START_HEALTH,
  LIVE_PACE_MIN_WINDOW_SEC, ROOM_STAT_PUSH_SEC, ROOM_TEAMMATES_POLL_MS,
} from './lib/gameEngine.js'

// OpenRouteService 키가 있으면 좀비가 실제 도로/인도 경로를 따라 쫓아오고,
// 없으면(또는 요청 실패 시) 자동으로 직선 이동으로 대체됨
const ORS_API_KEY = import.meta.env.VITE_ORS_API_KEY
// 내 생존 상태를 방(그룹)에 올림. 실패해도 게임에는 영향 없음 (다음 주기에 다시 시도됨)
function pushRoomStat(game, status) {
  if (!supabase || !game.roomId || !game.roomPlayerId) return
  updateRoomStat(game.roomId, game.distance, game.health, status).catch(() => {})
}

export default function App() {
  const gameRef = useRef(null)
  if (!gameRef.current) gameRef.current = makeInitialGame()
  const game = gameRef.current
  const [, setTick] = useState(0)
  const rerender = useCallback(() => setTick((n) => n + 1), [])

  const [mode, setMode] = useBackableStep('game', 'zr-mode') // 'game' | 'admin' | 'room'
  const modeRef = useRef(mode)
  modeRef.current = mode
  const [zombieMaps, setZombieMaps] = useState([])
  const [geoError, setGeoError] = useState('')
  const [starting, setStarting] = useState(false)
  const startingRef = useRef(false)
  const startRequestRef = useRef(0)
  const [follow, setFollow] = useState(true)
  const [paceIdx, setPaceIdx] = useState(DEFAULT_PACE_IDX)
  const [playMode, setPlayMode] = useState('free')
  const [radiusIdx, setRadiusIdx] = useState(DEFAULT_RADIUS_IDX)
  const [toastMsg, setToastMsg] = useState('')
  const toastTimerRef = useRef(null)
  const watchIdRef = useRef(null)
  const tickIntervalRef = useRef(null)
  const [teammates, setTeammates] = useState([])
  const [showTeammates, setShowTeammates] = useState(false)
  const teammatesPollRef = useRef(null)

  const [adminSession, setAdminSession] = useState(null)
  const [adminSessionChecked, setAdminSessionChecked] = useState(false)
  const [passwordRecovery, setPasswordRecovery] = useState(false)
  const [profileReady, setProfileReady] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [profileRetry, setProfileRetry] = useState(0)
  const [showAccount, setShowAccount] = useState(accountLanding)
  const [accountUsername, setAccountUsername] = useState('')

  useEffect(() => {
    if (!supabase) {
      setAdminSessionChecked(true)
      return
    }
    supabase.auth.getSession().then(({ data }) => {
      setAdminSession(data.session?.user?.is_anonymous ? null : data.session)
      setAdminSessionChecked(true)
    }).catch(() => { setAdminSessionChecked(true) })
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      setAdminSession(session?.user?.is_anonymous ? null : session)
      // 비밀번호 재설정 메일의 링크를 눌러서 돌아온 경우 — 새 비밀번호 설정 화면을 띄움
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    let active = true
    setProfileReady(false)
    setProfileError('')
    if (adminSession) {
      ensureOwnProfile().then(async () => {
        const { data, error } = await supabase.from('profiles').select('username').eq('id', adminSession.user.id).single()
        if (error) throw error
        if (active) { setAccountUsername(data.username); setProfileReady(true) }
      })
        .catch(error => { if (active) setProfileError(error.message) })
    }
    return () => { active = false }
  }, [adminSession?.user?.id, profileRetry])

  useEffect(() => {
    const url = new URL(window.location.href)
    if (accountLanding) {
      setMode('admin')
      url.searchParams.delete('account')
      window.history.replaceState(window.history.state, '', url)
    }
  }, [setMode])

  const adminLogout = useCallback(async () => {
    if (!supabase) return
    await supabase.auth.signOut()
    setMode('game')
  }, [setMode])

  const toast = useCallback((msg) => {
    setToastMsg(msg)
    clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToastMsg(''), 2600)
  }, [])

  const refreshZombieMaps = useCallback(async () => {
    setZombieMaps(await fetchZombieMaps())
  }, [])

  useEffect(() => {
    refreshZombieMaps()
  }, [refreshZombieMaps])

  const endGame = useCallback(
    (reason) => {
      if (game.status !== 'playing') return
      game.status = 'gameover'
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
      game.gameOverReason = reason
      clearInterval(tickIntervalRef.current)
      if (game.roomId) {
        pushRoomStat(game, reason === 'manual' ? 'finished' : 'caught')
        clearInterval(teammatesPollRef.current)
      }
      rerender()
    },
    [game, rerender]
  )

  const tick = useCallback(() => {
    if (game.status !== 'playing') return
    const now = Date.now()
    const dt = Math.min(2, Math.max(0, (now - game.lastTickAt) / 1000))
    game.lastTickAt = now
    if (modeRef.current !== 'game' || document.hidden || !game.lastFix || now - game.lastFix.t > GPS_STALE_MS) {
      if (!document.hidden) setGeoError('GPS 신호를 기다리는 동안 게임이 잠시 멈춰요.')
      rerender()
      return
    }
    const result = advanceGame(game, dt, now)
    result.messages.forEach(toast)
    if (result.endReason) {
      endGame(result.endReason)
      return
    }

    const needsRoute = findRouteCandidate(game, now)
      if (needsRoute && ORS_API_KEY) {
        const runId = game.runId
        const targetId = needsRoute.id
        const targetPos = { lat: game.playerPos.lat, lon: game.playerPos.lon }
        const fromPos = { lat: needsRoute.lat, lon: needsRoute.lon }
        game.zombies = game.zombies.map((z) => (z.id === targetId ? { ...z, routing: true } : z))
        fetchWalkingPath(ORS_API_KEY, fromPos, targetPos).then((path) => {
          if (game.runId !== runId || game.status !== "playing") return
          game.zombies = game.zombies.map((z) => {
            if (z.id !== targetId) return z
            if (path && (!z.patrolRoute || z.state === 'chase')) {
              const nearest = closestRouteIndex(path, z)
              return { ...z, path: [{ lat: z.lat, lon: z.lon }, ...path.slice(nearest + 1)],
                pathFetchedFor: targetPos, lastRouteAt: Date.now(), routing: false }
            }
            return { ...z, routing: false, pathFetchedFor: targetPos, lastRouteAt: Date.now() }
          })
          rerender()
        })
      }

    if (game.roomId && now - game.lastStatAt >= ROOM_STAT_PUSH_SEC * 1000) {
      game.lastStatAt = now
      pushRoomStat(game, 'alive')
    }

    rerender()
  }, [game, rerender, toast, endGame])

  const handlePosition = useCallback((position) => {
    const fix = document.hidden ? null : readFix(position)
    if (!fix || (game.lastFix && fix.t <= game.lastFix.t)) {
      if (!fix) { game.lastFix = null; setGeoError('GPS 정확도가 낮아요. 신호가 좋아지면 자동으로 이어져요.') }
      return
    }
    if (game.status !== 'playing') return
    const now = Date.now()
    updatePosition(game, fix, now)
    setGeoError('')
    rerender()
  }, [game, rerender])

  useEffect(() => {
    return () => {
      startRequestRef.current += 1
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current)
      clearInterval(tickIntervalRef.current)
      clearTimeout(toastTimerRef.current)
      clearInterval(teammatesPollRef.current)
    }
  }, [])

  const pollTeammates = useCallback(async () => {
    if (!supabase || !game.roomId) return
    const runId = game.runId
    try {
      const result = await readRoom(game.roomId)
      if (game.runId === runId) setTeammates(result.players)
    } catch { /* retry on the next interval */ }
  }, [game])

  const startRun = useCallback((config, session) => {
    if (startingRef.current || game.status === 'playing') return Promise.resolve(false)
    if (!navigator.geolocation) {
      setGeoError('이 기기/브라우저는 위치 정보를 지원하지 않아요.')
      return Promise.resolve(false)
    }
    startingRef.current = true
    setStarting(true)
    setGeoError('')
    const request = ++startRequestRef.current
    return new Promise(resolve => {
      const fail = message => {
        if (request === startRequestRef.current) {
          startingRef.current = false
          setStarting(false)
          setGeoError(message)
        }
        resolve(false)
      }
      navigator.geolocation.getCurrentPosition(position => {
        if (request !== startRequestRef.current) return resolve(false)
        const startPos = readFix(position)
        if (!startPos) return fail('GPS 신호가 부정확해요. 야외에서 다시 시작해주세요.')
        const forcedMap = config.mapId ? zombieMaps.find(m => m.id === config.mapId) : null
        if (config.mapId && !forcedMap) return fail('선택한 지도가 없어요. 방에서 지도를 다시 선택해주세요.')
        if (forcedMap && haversineDistance(startPos.lat, startPos.lon, forcedMap.center.lat, forcedMap.center.lon) > forcedMap.radius)
          return fail('방장이 선택한 지도 구역 안으로 이동한 뒤 다시 시도해주세요.')
        clearInterval(tickIntervalRef.current)
        clearInterval(teammatesPollRef.current)
        if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current)
        Object.assign(game, makeInitialGame(), {
          status: 'playing', playerPos: startPos, lastPos: startPos, lastFix: startPos,
          movementAnchor: startPos, lastTickAt: Date.now(),
          roomId: session?.roomId ?? null, roomPlayerId: session?.playerId ?? null,
          roomNickname: session?.nickname ?? null,
        })
        const matched = applyStartSetup(game, startPos, {
          paceMps: (PACE_PRESETS[config.paceIdx] ?? PACE_PRESETS[DEFAULT_PACE_IDX]).mps,
          playMode: config.playMode === 'restricted' ? 'restricted' : 'free',
          radiusM: AREA_RADIUS_PRESETS[config.radiusIdx] ?? AREA_RADIUS_PRESETS[DEFAULT_RADIUS_IDX],
          zombieMaps, forcedMap,
        })
        if (matched) toast('선택된 좀비 경로로 시작해요: ' + matched.name)
        watchIdRef.current = navigator.geolocation.watchPosition(handlePosition,
          () => { game.lastFix = null; setGeoError('GPS 신호가 끊겨 게임이 잠시 멈춰요.') },
          { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 })
        tickIntervalRef.current = setInterval(tick, 1000)
        if (session) {
          pollTeammates()
          teammatesPollRef.current = setInterval(pollTeammates, ROOM_TEAMMATES_POLL_MS)
        }
        startingRef.current = false
        setStarting(false)
        rerender()
        resolve(true)
      }, () => fail('위치를 확인하지 못했어요. 위치 권한을 확인하고 다시 시도해주세요.'),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 })
    })
  }, [game, zombieMaps, handlePosition, tick, pollTeammates, toast, rerender])

  useEffect(() => {
    const visibilityChanged = () => {
      game.lastFix = null
      game.movementAnchor = null
      game.lastTickAt = Date.now()
    }
    document.addEventListener('visibilitychange', visibilityChanged)
    return () => document.removeEventListener('visibilitychange', visibilityChanged)
  }, [game])

  useEffect(() => {
    if (startingRef.current) {
      startRequestRef.current += 1
      startingRef.current = false
      setStarting(false)
    }
  }, [mode])

  const requestLocationAndStart = useCallback(() =>
    startRun({ paceIdx, playMode, radiusIdx }), [startRun, paceIdx, playMode, radiusIdx])

  const finishRun = useCallback(() => endGame('manual'), [endGame])

  const restart = requestLocationAndStart

  const backToStart = useCallback(() => {
    const keepPos = game.playerPos
    Object.assign(game, makeInitialGame())
    game.playerPos = keepPos
    game.lastPos = keepPos
    rerender()
  }, [game, rerender])

  if (passwordRecovery) {
    return <ResetPassword onDone={() => setPasswordRecovery(false)} />
  }

  if (showAccount) {
    return <div className="zr-screen zr-start"><div className="zr-start-card">
      <h1 className="zr-title">아이디 찾기</h1>
      {!adminSessionChecked ? <p role="status">이메일 인증을 확인하고 있어요…</p> :
        !adminSession ? <p role="alert">링크가 만료됐거나 인증되지 않았어요. 아이디 찾기 메일을 다시 요청해주세요.</p> :
        profileError ? <><p role="alert">{profileError}</p><button className="zr-btn zr-btn-primary" onClick={() => setProfileRetry(n => n + 1)}>다시 시도</button></> :
        !profileReady ? <p role="status">아이디를 확인하고 있어요…</p> :
        <><p>가입하신 아이디입니다.</p><p className="zr-title"><strong>{accountUsername}</strong></p><p>이메일 인증으로 로그인되었습니다.</p></>}
      <button className="zr-btn zr-btn-primary" onClick={() => { setShowAccount(false); setMode('admin') }}>계정 화면으로</button>
      <button className="zr-btn zr-btn-ghost" onClick={() => { setShowAccount(false); setMode('game') }}>게임으로 돌아가기</button>
    </div></div>
  }

  if (mode === 'admin') {
    if (supabase && !adminSessionChecked) {
      return (
        <div className="zr-screen zr-start">
          <div className="zr-start-card">
            <p className="zr-subtitle">확인하는 중…</p>
          </div>
        </div>
      )
    }
    if (supabase && !adminSession) {
      return <AuthScreen onBack={() => setMode('game')} />
    }
    if (adminSession && !profileReady) {
      return <div className="zr-screen zr-start"><div className="zr-start-card">
        <p role={profileError ? 'alert' : 'status'}>{profileError || '계정 정보를 준비하고 있어요…'}</p>
        {profileError && <button className="zr-btn zr-btn-primary" onClick={() => setProfileRetry(n => n + 1)}>다시 시도</button>}
        <button className="zr-btn zr-btn-ghost" onClick={adminLogout}>로그아웃하고 돌아가기</button>
      </div></div>
    }
    return (
      <AdminRouteEditor
        onBack={() => setMode('game')}
        onSaved={refreshZombieMaps}
        onLogout={supabase ? adminLogout : null}
        session={adminSession}
      />
    )
  }

  if (mode === 'room') {
    return (
      <RoomLobby
        zombieMaps={zombieMaps}
        onBack={() => setMode('game')}
        startError={geoError}
        onStart={async (config, session) => {
          const started = await startRun(config, session)
          if (started) setMode('game')
          return started
        }}
      />
    )
  }

  if (game.status === 'start') {
    return (
      <div className="zr-screen zr-start">
        <div className="zr-start-card">
          <h1 className="zr-title">🧟 좀비 런</h1>
          <p className="zr-subtitle">실제 GPS를 쓰기 때문에, 살아남는 방법은 진짜로 뛰는 것뿐입니다.</p>
          <ul className="zr-rules">
            <li>러닝 시작 60초 뒤, 좀비 무리 등장</li>
            <li>좀비에게 12m 안으로 붙잡히면 생명이 줄어요</li>
            <li>모래시계(⏳) 아이템으로 좀비 10초간 정지</li>
            <li>오직 도망치는 것만이 살아남는 방법!</li>
          </ul>
          <p className="zr-pace-label">목표 페이스 (좀비가 이 속도로 쫓아와요)</p>
          <div className="zr-pace-picker">
            {PACE_PRESETS.map((p, i) => (
              <button
                key={p.label}
                className={i === paceIdx ? 'zr-pace-btn zr-pace-btn-on' : 'zr-pace-btn'}
                onClick={() => setPaceIdx(i)}
              >
                {p.label}
              </button>
            ))}
          </div>

          <p className="zr-pace-label">플레이 모드</p>
          <div className="zr-pace-picker zr-pace-picker-2col">
            <button
              className={playMode === 'free' ? 'zr-pace-btn zr-pace-btn-on' : 'zr-pace-btn'}
              onClick={() => setPlayMode('free')}
            >
              자유 모드
            </button>
            <button
              className={playMode === 'restricted' ? 'zr-pace-btn zr-pace-btn-on' : 'zr-pace-btn'}
              onClick={() => setPlayMode('restricted')}
            >
              제한구역 모드
            </button>
          </div>
          {playMode === 'restricted' && (
            <>
              <p className="zr-pace-label">플레이 반경 (지금 위치 기준)</p>
              <div className="zr-pace-picker">
                {AREA_RADIUS_PRESETS.map((r, i) => (
                  <button
                    key={r}
                    className={i === radiusIdx ? 'zr-pace-btn zr-pace-btn-on' : 'zr-pace-btn'}
                    onClick={() => setRadiusIdx(i)}
                  >
                    {r >= 1000 ? `${r / 1000}km` : `${r}m`}
                  </button>
                ))}
              </div>
              <p className="zr-pace-hint">이 반경 밖에 1시간 넘게 있으면 생명이 1개씩 줄어요.</p>
            </>
          )}

          {geoError && <p className="zr-error">{geoError}</p>}
          <button className="zr-btn zr-btn-primary" onClick={requestLocationAndStart} disabled={starting}>
            {starting ? '위치 확인 중…' : '도망치기 시작 🏃'}
          </button>
          <button className="zr-btn zr-btn-ghost" disabled={starting} onClick={() => setMode('room')}>
            👥 그룹으로 같이 뛰기
          </button>
          <button className="zr-admin-link" disabled={starting} onClick={() => setMode('admin')}>
            🛠️ 내 좀비 경로 만들기 (로그인 필요)
          </button>
        </div>
      </div>
    )
  }

  if (game.status === 'gameover') {
    const reasonText =
      game.gameOverReason === 'caught'
        ? '좀비 무리에게 붙잡혔어요 💀'
        : game.gameOverReason === 'outside_area'
          ? '제한구역을 너무 오래 벗어나 있었어요 🗺️'
          : '무사히 도망치는 데 성공했어요 🎉'
    return (
      <div className="zr-screen zr-start">
        <div className="zr-start-card">
          <h1 className="zr-title">{reasonText}</h1>
          {geoError && <p role="alert" className="zr-error">{geoError}</p>}
          <div className="zr-result-grid">
            <div>
              <div className="zr-result-num">{formatTime(game.elapsedSec)}</div>
              <div className="zr-result-label">생존 시간</div>
            </div>
            <div>
              <div className="zr-result-num">{formatDistance(game.distance)}</div>
              <div className="zr-result-label">달린 거리</div>
            </div>
          </div>
          <button className="zr-btn zr-btn-primary" onClick={restart} disabled={starting}>
            {starting ? '위치 확인 중…' : game.roomId ? '혼자 다시 도전하기' : '다시 도전하기'}
          </button>
          <button className="zr-btn zr-btn-ghost" onClick={backToStart} disabled={starting}>
            처음으로
          </button>
        </div>
      </div>
    )
  }

  const nearestZombieDist = game.zombies.length && game.playerPos
    ? Math.min(
        ...game.zombies.map((z) => haversineDistance(game.playerPos.lat, game.playerPos.lon, z.lat, z.lon))
      )
    : null
  const frozenActive = Date.now() < game.frozenUntil
  let livePaceMps = null
  if (game.paceSamples.length >= 2) {
    const first = game.paceSamples[0]
    const last = game.paceSamples[game.paceSamples.length - 1]
    const dtSec = (last.t - first.t) / 1000
    if (dtSec >= LIVE_PACE_MIN_WINDOW_SEC) livePaceMps = (last.d - first.d) / dtSec
  }
  const behindPace = livePaceMps != null && livePaceMps < game.targetPaceMps * 0.97
  const outsideArea =
    game.playMode === 'restricted' &&
    game.areaCenter &&
    game.playerPos &&
    haversineDistance(game.areaCenter.lat, game.areaCenter.lon, game.playerPos.lat, game.playerPos.lon) >
      game.areaRadius

  return (
    <div className="zr-screen">
      <div className="zr-hud-top">
        <div className="zr-hud-stat">
          <div className="zr-hud-value">{formatTime(game.elapsedSec)}</div>
          <div className="zr-hud-label">시간</div>
        </div>
        <div className="zr-hud-stat">
          <div className="zr-hud-value">{formatDistance(game.distance)}</div>
          <div className="zr-hud-label">거리</div>
        </div>
        <div className="zr-hud-stat">
          <div className="zr-hud-value">{nearestZombieDist == null ? '-' : formatDistance(nearestZombieDist)}</div>
          <div className="zr-hud-label">가까운 좀비</div>
        </div>
      </div>

      <div className={behindPace ? 'zr-pace-bar zr-pace-bar-behind' : 'zr-pace-bar'}>
        🏃 {livePaceMps == null ? '측정 중…' : `${formatPace(livePaceMps)}/km`}
        <span className="zr-pace-vs">vs</span>🧟 {formatPace(game.targetPaceMps)}/km
      </div>

      <GameMap
        playerPos={game.playerPos}
        zombies={game.zombies}
        pickups={game.pickups}
        follow={follow}
        areaCenter={game.areaCenter}
        areaRadius={game.areaRadius}
      />

      <div className="zr-hud-side">
        <div className="zr-hearts">
          {Array.from({ length: START_HEALTH }).map((_, i) => (
            <span key={i} className={i < game.health ? 'zr-heart zr-heart-on' : 'zr-heart'}>
              ❤️
            </span>
          ))}
        </div>
        {game.roomId && (
          <button className="zr-badge" onClick={() => setShowTeammates((v) => !v)}>
            👥 {teammates.length}
          </button>
        )}
      </div>

      {game.roomId && showTeammates && (
        <div className="zr-teammates-panel">
          <div className="zr-teammates-header">
            <span>동료 ({teammates.length}명)</span>
            <button className="zr-round-btn" onClick={() => setShowTeammates(false)}>
              ✕
            </button>
          </div>
          {teammates.map((p) => (
            <div key={p.id} className="zr-teammate-row">
              <span className="zr-teammate-name">
                {p.nickname}
                {p.id === game.roomPlayerId ? ' (나)' : ''}
              </span>
              <span className="zr-teammate-stats">
                {(p.distance_m / 1000).toFixed(2)}km · {p.health != null ? '❤️'.repeat(Math.min(START_HEALTH, Math.max(0, Number(p.health) || 0))) : ''}
                {p.status === 'caught' && ' 💀'}
                {p.status === 'finished' && ' 🏁'}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="zr-banner-stack">
        {Date.now() < game.invulnerableUntil && <div className="zr-banner zr-banner-blue">잠시 보호 중이에요. 좀비에게서 떨어져주세요.</div>}
        {frozenActive && <div className="zr-banner zr-banner-blue">⏳ 좀비 이동 정지 중</div>}
        {outsideArea && <div className="zr-banner zr-banner-red">⚠️ 제한구역을 벗어났어요</div>}
        {geoError && <div className="zr-banner zr-banner-red">{geoError}</div>}
      </div>
      {toastMsg && <div className="zr-toast">{toastMsg}</div>}

      <div className="zr-hud-bottom">
        <button className="zr-round-btn" aria-label={follow ? "지도 자유 이동" : "내 위치 따라가기"} onClick={() => setFollow((f) => !f)}>
          {follow ? '📍' : '🗺️'}
        </button>
        <button className="zr-btn zr-btn-ghost zr-btn-small" onClick={finishRun}>
          종료
        </button>
      </div>
    </div>
  )
}
