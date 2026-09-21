import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import AuthScreen from './AuthScreen.jsx'
import ResetPassword from './ResetPassword.jsx'
import RunBriefing from './RunBriefing.jsx'
import GameIcon from './GameIcon.jsx'
import Leaderboard from './Leaderboard.jsx'
import { rankPlayers } from './lib/leaderboard.js'
import { createProximityAlert } from './lib/proximityAlert.js'
import { createRoomReporter } from './lib/roomReporter.js'
import { formatDistance, haversineDistance } from './lib/geo.js'
import { fetchWalkingPath } from './lib/routing.js'
import { supabase } from './lib/supabaseClient.js'
import { AREA_RADIUS_PRESETS, DEFAULT_PACE_IDX, DEFAULT_RADIUS_IDX, PACE_PRESETS } from './lib/gameConfig.js'
import { fetchZombieMaps } from './lib/zombieMaps.js'
import { useBackableStep } from './lib/useBackableStep.js'
import { ensureOwnProfile } from './lib/authHelpers.js'
import { accountLanding, passwordRecoveryExpired } from './lib/authLanding.js'
import { readRoom, updateRoomStat } from './lib/roomApi.js'
import { readFix, GPS_STALE_MS } from './lib/gameSafety.js'
import { isLocalTestMode, makeTestPosition } from './lib/testMode.js'
import { insideArea } from './lib/playArea.js'
import {
  makeInitialGame, applyStartSetup, advanceGame, updatePosition, findRouteCandidate,
  closestRouteIndex, formatTime, formatPace, START_HEALTH,
  LIVE_PACE_MIN_WINDOW_SEC, ROOM_STAT_PUSH_SEC, ROOM_TEAMMATES_POLL_MS,
} from './lib/gameEngine.js'

// OpenRouteService 키가 있으면 좀비가 실제 도로/인도 경로를 따라 쫓아오고,
// 없으면(또는 요청 실패 시) 자동으로 직선 이동으로 대체됨
const ORS_API_KEY = import.meta.env.VITE_ORS_API_KEY
let GameMap
const loadGameMap = async () => {
  const module = await import('./GameMap.jsx')
  GameMap = module.default
}
const AdminRouteEditor = lazy(() => import('./AdminRouteEditor.jsx'))
const RoomLobby = lazy(() => import('./RoomLobby.jsx'))
const loadingScreen = <div className="zr-screen zr-start"><p role="status">화면을 불러오는 중…</p></div>

export default function App() {
  return <Suspense fallback={loadingScreen}><GameApp /></Suspense>
}

function GameApp() {
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
  const reporterRef = useRef(null)
  const rankingPollRef = useRef(null)
  const [rankingError, setRankingError] = useState('')
  const [saveState, setSaveState] = useState('')
  const [vibrationOn, setVibrationOn] = useState(true)
  const vibrationEnabled = useRef(true)
  const proximityRef = useRef(null)
  if (!proximityRef.current) proximityRef.current = createProximityAlert(pattern => navigator.vibrate?.(pattern))
  const toggleVibration = () => {
    const next = !vibrationEnabled.current
    vibrationEnabled.current = next
    setVibrationOn(next)
    if (!next) proximityRef.current.stop()
  }

  const [adminSession, setAdminSession] = useState(null)
  const [adminSessionChecked, setAdminSessionChecked] = useState(false)
  const [passwordRecovery, setPasswordRecovery] = useState(false)
  const [recoveryExpired, setRecoveryExpired] = useState(passwordRecoveryExpired)
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
    if (accountLanding || passwordRecoveryExpired) {
      setMode('admin')
      url.searchParams.delete('account')
      if (passwordRecoveryExpired) url.hash = ''
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
      proximityRef.current.stop()
      if (game.roomId) {
        setSaveState('saving')
        reporterRef.current?.submit({ distance: game.distance, health: game.health,
          elapsed: game.elapsedSec, status: reason === 'manual' ? 'finished' : 'caught' })
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
      proximityRef.current.stop()
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
    const nearest = game.playerPos && game.zombies.length
      ? Math.min(...game.zombies.map(z => haversineDistance(game.playerPos.lat, game.playerPos.lon, z.lat, z.lon))) : Infinity
    proximityRef.current.update(nearest, now, vibrationEnabled.current && now >= game.frozenUntil)

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
      reporterRef.current?.submit({ distance: game.distance, health: game.health, elapsed: game.elapsedSec, status: 'alive' })
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
      reporterRef.current?.dispose()
      proximityRef.current.stop()
    }
  }, [])

  const pollTeammates = useCallback(async () => {
    if (!supabase || !game.roomId) return
    const runId = game.runId
    if (rankingPollRef.current === runId) return
    rankingPollRef.current = runId
    reporterRef.current?.retry()
    try {
      const result = await readRoom(game.roomId)
      if (game.runId === runId) { setTeammates(result.players); setRankingError('') }
    } catch {
      if (game.runId === runId) setRankingError('연결 지연 · 마지막으로 확인한 순위예요. 자동으로 다시 연결합니다.')
    } finally {
      if (rankingPollRef.current === runId) rankingPollRef.current = null
    }
  }, [game])

  const startRun = useCallback((config, session) => {
    if (startingRef.current || game.status === 'playing') return Promise.resolve(false)
    if (!navigator.geolocation && !isLocalTestMode()) {
      setGeoError('이 기기/브라우저는 위치 정보를 지원하지 않아요.')
      return Promise.resolve(false)
    }
    startingRef.current = true
    setStarting(true)
    setGeoError('')
    const request = ++startRequestRef.current
    return loadGameMap().then(() => new Promise(resolve => {
      if (request !== startRequestRef.current) return resolve(false)
      const fail = message => {
        if (request === startRequestRef.current) {
          startingRef.current = false
          setStarting(false)
          setGeoError(message)
        }
        resolve(false)
      }
      const beginWithPosition = position => {
        if (request !== startRequestRef.current) return resolve(false)
        const gpsStartPos = readFix(position)
        if (!gpsStartPos) return fail('GPS 신호가 부정확해요. 야외에서 다시 시작해주세요.')
        const forcedMap = config.mapId ? zombieMaps.find(m => m.id === config.mapId) : null
        if (config.mapId && !forcedMap) return fail('선택한 지도가 없어요. 방에서 지도를 다시 선택해주세요.')
        const startPos = isLocalTestMode() && forcedMap
          ? { ...gpsStartPos, ...(forcedMap.boundary ? forcedMap.routes[0][0] : forcedMap.center) }
          : gpsStartPos
        if (!isLocalTestMode() && forcedMap && !insideArea(startPos, forcedMap.center, forcedMap.radius, forcedMap.boundary))
          return fail('방장이 선택한 지도 구역 안으로 이동한 뒤 다시 시도해주세요.')
        clearInterval(tickIntervalRef.current)
        clearInterval(teammatesPollRef.current)
        reporterRef.current?.dispose()
        reporterRef.current = null
        proximityRef.current.stop()
        setTeammates([])
        setShowTeammates(false)
        setRankingError('')
        setSaveState('')
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
          forcedMap,
        })
        if (matched) toast('선택된 좀비 경로로 시작해요: ' + matched.name)
        if (isLocalTestMode()) {
          let testStep = 0
          watchIdRef.current = null
          tickIntervalRef.current = setInterval(() => {
            testStep += 1
            handlePosition(makeTestPosition(Date.now(), testStep, startPos))
            tick()
          }, 1000)
        } else {
          watchIdRef.current = navigator.geolocation.watchPosition(handlePosition,
            () => { game.lastFix = null; setGeoError('GPS 신호가 끊겨 게임이 잠시 멈춰요.') },
            { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 })
          tickIntervalRef.current = setInterval(tick, 1000)
        }
        if (session) {
          const runId = game.runId
          reporterRef.current = createRoomReporter(
            s => updateRoomStat(session.roomId, s.distance, s.health, s.status, s.elapsed),
            s => { if (game.runId === runId) { setSaveState(s.status === 'alive' ? '' : 'saved'); void pollTeammates() } },
            () => { if (game.runId === runId) setSaveState('error') },
          )
          pollTeammates()
          teammatesPollRef.current = setInterval(pollTeammates, ROOM_TEAMMATES_POLL_MS)
        }
        startingRef.current = false
        setStarting(false)
        rerender()
        resolve(true)
      }
      if (isLocalTestMode()) {
        queueMicrotask(() => beginWithPosition(makeTestPosition()))
      } else {
        navigator.geolocation.getCurrentPosition(beginWithPosition,
          () => fail('위치를 확인하지 못했어요. 위치 권한을 확인하고 다시 시도해주세요.'),
          { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 })
      }
    })).catch(() => {
      if (request === startRequestRef.current) {
        startingRef.current = false
        setStarting(false)
        setGeoError('지도를 불러오지 못했어요. 연결을 확인하고 다시 시작해주세요.')
      }
      return false
    })
  }, [game, zombieMaps, handlePosition, tick, pollTeammates, toast, rerender])

  useEffect(() => {
    const visibilityChanged = () => {
      proximityRef.current.stop()
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
    clearInterval(teammatesPollRef.current)
    reporterRef.current?.dispose()
    const keepPos = game.playerPos
    Object.assign(game, makeInitialGame())
    game.playerPos = keepPos
    game.lastPos = keepPos
    rerender()
  }, [game, rerender])

  if (passwordRecovery) {
    return <ResetPassword onDone={() => setPasswordRecovery(false)} />
  }

  if (recoveryExpired) {
    return <AuthScreen onBack={() => { setRecoveryExpired(false); setMode('game') }}
      initialTab="forgot"
      initialMessage="이 재설정 링크는 만료됐거나 이미 사용됐어요. 아이디를 입력해 새 메일을 받은 뒤, 가장 최근 메일을 열어주세요." />
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
      <div className="zr-screen zr-start zr-home">
        <RunBriefing />
        <div className="zr-start-card zr-launch-card">
          <p className="zr-eyebrow">READY TO RUN</p>
          <h2 className="zr-title">오늘의 러닝 설정</h2>
          <p className="zr-subtitle">추격 속도를 정하고, 출발하세요.</p>
          <p className="zr-pace-label">목표 페이스 (좀비가 이 속도로 쫓아와요)</p>
          <div className="zr-pace-picker">
            {PACE_PRESETS.map((p, i) => (
              <button
                key={p.label}
                aria-pressed={i === paceIdx}
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
              aria-pressed={playMode === 'free'}
              className={playMode === 'free' ? 'zr-pace-btn zr-pace-btn-on' : 'zr-pace-btn'}
              onClick={() => setPlayMode('free')}
            >
              자유 모드
            </button>
            <button
              aria-pressed={playMode === 'restricted'}
              className={playMode === 'restricted' ? 'zr-pace-btn zr-pace-btn-on' : 'zr-pace-btn'}
              onClick={() => setPlayMode('restricted')}
            >
              제한구역 모드
            </button>
          </div>
          <p className="zr-mode-description">{playMode === 'free' ? '정해진 구역 없이, 원하는 길로 달리세요.' : '선택한 반경 안에서 도망치는 구역 생존 모드.'}</p>
          {playMode === 'restricted' && (
            <>
              <p className="zr-pace-label">플레이 반경 (지금 위치 기준)</p>
              <div className="zr-pace-picker">
                {AREA_RADIUS_PRESETS.map((r, i) => (
                  <button
                    key={r}
                    aria-pressed={i === radiusIdx}
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
            <GameIcon name="run" size={21} />
            <span>{starting ? '위치 확인 중…' : isLocalTestMode() ? '테스트 위치로 시작' : '생존 러닝 시작'}</span>
          </button>
          <button className="zr-btn zr-btn-ghost" disabled={starting} onClick={() => setMode('room')}>
            <GameIcon name="users" size={20} />
            <span>그룹 러닝 · 닉네임 / 코드</span>
          </button>
          <p className="zr-mode-description">자유 모드도 닉네임과 방 코드로 함께 참가하고, 생존 랭킹을 겨뤄보세요.</p>
          <p className="zr-location-note">{typeof navigator.vibrate === 'function' ? '좀비 70m 이내 접근 시 진동 · 게임 중 끄기 가능' : '이 브라우저는 진동을 지원하지 않아 화면으로 경고해요.'}</p>
          <button className="zr-admin-link" disabled={starting} onClick={() => setMode('admin')}>
            <GameIcon name="route" size={18} />
            <span>좀비 경로 만들기</span>
          </button>
          <p className="zr-location-note">위치 권한 필요 · 야외에서 시작해주세요</p>
          {isLocalTestMode() && <p className="zr-test-note">로컬 테스트 모드 · 가상 위치로 진행 중</p>}
        </div>
      </div>
    )
  }

  if (game.status === 'gameover') {
    const reasonText =
      game.gameOverReason === 'caught'
        ? '좀비에게 붙잡혔습니다'
        : game.gameOverReason === 'outside_area'
          ? '생존 구역을 이탈했습니다'
          : '러닝을 완료했습니다'
    return (
      <div className="zr-screen zr-start">
        <div className="zr-start-card">
          <p className="zr-eyebrow">RUN REPORT / COMPLETE</p>
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
          {game.roomId && <>
            <p role="status" className="zr-ranking-note">{saveState === 'saved' ? '내 최종 기록 저장 완료' : saveState === 'error' ? '기록 저장 재시도 중 · 이 화면을 유지해주세요.' : '내 최종 기록 저장 중…'}</p>
            {saveState !== 'saved' && <p className="zr-ranking-note">저장되기 전에 나가면 최종 기록이 누락될 수 있어요.</p>}
            <Leaderboard players={teammates} playerId={game.roomPlayerId} error={rankingError} />
          </>}
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
    !insideArea(game.playerPos, game.areaCenter, game.areaRadius, game.areaBoundary)
  const threatBand = nearestZombieDist == null ? 'clear' : nearestZombieDist <= 25 ? 'critical' : nearestZombieDist <= 70 ? 'near' : 'tracked'
  const threatLabel = nearestZombieDist == null ? '탐색 중' : threatBand === 'critical' ? '즉시 도주' : threatBand === 'near' ? '접근 중' : '추적 감지'
  const frozenRemaining = frozenActive ? Math.max(0, Math.ceil((game.frozenUntil - Date.now()) / 1000)) : 0
  const paceStatus = livePaceMps == null ? '페이스 측정 중' : behindPace ? '속도를 올리세요' : '현재 페이스 유지'
  const runLabel = game.presetMap?.name || (game.playMode === 'restricted' ? 'BOUNDARY RUN' : 'FREE RUN')
  const gpsPaused = Boolean(geoError)
  const currentWave = Math.max(1, game.waveCount)

  return (
    <div className={`zr-screen zr-game-shell zr-threat-${threatBand}${outsideArea ? ' zr-outside-area' : ''}`}>
      <GameMap
        playerPos={game.playerPos}
        zombies={game.zombies}
        pickups={game.pickups}
        follow={follow}
        areaCenter={game.areaCenter}
        areaRadius={game.areaRadius}
        areaBoundary={game.areaBoundary}
        headingDeg={gpsPaused ? null : game.headingDeg}
        trailDistance={game.distance}
        trackingPaused={gpsPaused}
        patrolRoutes={game.presetMap?.routes}
      />

      <header className="zr-game-header">
        <div className="zr-game-statusline">
          <span className={gpsPaused ? 'zr-live-state zr-live-paused' : 'zr-live-state'}><i /> {gpsPaused ? 'RUN PAUSED' : 'LIVE RUN'}</span>
          <span><GameIcon name="signal" size={14} /> {gpsPaused ? 'GPS PAUSED' : 'GPS LINK'}</span>
          <span>{game.presetMap ? 'ROUTE RUN' : `WAVE ${String(currentWave).padStart(2, '0')}`}</span>
        </div>
        <div className="zr-hud-top" aria-label="러닝 현황">
        <div className="zr-hud-stat" aria-label={`경과 시간 ${formatTime(game.elapsedSec)}`}>
          <div className="zr-hud-value">{formatTime(game.elapsedSec)}</div>
          <div className="zr-hud-label">시간</div>
        </div>
        <div className="zr-hud-stat" aria-label={`달린 거리 ${formatDistance(game.distance)}`}>
          <div className="zr-hud-value">{formatDistance(game.distance)}</div>
          <div className="zr-hud-label">거리</div>
        </div>
        <div className="zr-hud-stat zr-hud-threat" aria-label={`가장 가까운 좀비 ${nearestZombieDist == null ? '탐색 중' : formatDistance(nearestZombieDist)}`}>
          <div className="zr-hud-value">{nearestZombieDist == null ? '—' : formatDistance(nearestZombieDist)}</div>
          <div className="zr-hud-label">위협 거리</div>
        </div>
      </div>

      <div className={behindPace ? 'zr-pace-bar zr-pace-bar-behind' : 'zr-pace-bar'}>
        <span className="zr-pace-side"><GameIcon name="run" size={17} /><span><small>내 페이스</small><strong>{livePaceMps == null ? '측정 중' : `${formatPace(livePaceMps)}/km`}</strong></span></span>
        <span className="zr-pace-vs">VS</span>
        <span className="zr-pace-side zr-pace-enemy"><GameIcon name="zombie" size={17} /><span><small>좀비 기준</small><strong>{formatPace(game.targetPaceMps)}/km</strong></span></span>
      </div>
      </header>

      <div className="zr-hud-side">
        <div className="zr-enemy-counter" aria-label={`활성 좀비 ${game.zombies.length}마리`}>
          <GameIcon name="zombie" size={18} />
          <strong>{game.zombies.length}</strong>
          <small>ACTIVE</small>
        </div>
        <div
          className={game.health <= 2 ? 'zr-hearts zr-vital-low' : 'zr-hearts'}
          role="meter"
          aria-label={`생명 ${game.health}/${START_HEALTH}`}
          aria-valuemin="0"
          aria-valuemax={START_HEALTH}
          aria-valuenow={game.health}
        >
          <span className="zr-vital-label">VITAL</span>
          <div className="zr-vital-segments" aria-hidden="true">
          {Array.from({ length: START_HEALTH }).map((_, i) => (
              <i key={i} className={i < game.health ? 'zr-heart zr-heart-on' : 'zr-heart'} />
          ))}
          </div>
          <strong className="zr-vital-value">{game.health}<small>/{START_HEALTH}</small></strong>
        </div>
        {frozenActive && <div className="zr-freeze-counter"><GameIcon name="freeze" size={18} /><strong>{frozenRemaining}s</strong><small>FREEZE</small></div>}
        {game.roomId && (
          <button className="zr-badge" aria-label="내 순위와 생존 랭킹" aria-expanded={showTeammates} onClick={() => setShowTeammates((v) => !v)}>
            <GameIcon name="users" size={18} /> <span>{rankPlayers(teammates).find(p => p.id === game.roomPlayerId)?.rank ?? '—'}위</span>
          </button>
        )}
        {typeof navigator.vibrate === 'function' && <button className="zr-badge" aria-label="좀비 접근 진동" aria-pressed={vibrationOn} onClick={toggleVibration}>진동<br />{vibrationOn ? 'ON' : 'OFF'}</button>}
      </div>

      {game.roomId && showTeammates && (
        <div className="zr-teammates-panel">
          <div className="zr-teammates-header">
            <span>LIVE RANKING</span>
            <button className="zr-round-btn" aria-label="랭킹 닫기" onClick={() => setShowTeammates(false)}>
              <GameIcon name="close" size={18} />
            </button>
          </div>
          <Leaderboard players={teammates} playerId={game.roomPlayerId} error={rankingError || (saveState === 'error' ? '내 기록 전송을 재시도하고 있어요.' : '')} />
        </div>
      )}

      <div className="zr-banner-stack">
        {Date.now() < game.invulnerableUntil && <div role="status" className="zr-banner zr-banner-blue"><GameIcon name="shield" size={17} /> 보호 시간 · 거리를 벌리세요</div>}
        {frozenActive && <div className="zr-banner zr-banner-blue"><GameIcon name="freeze" size={17} /> 좀비 이동 정지 · {frozenRemaining}초</div>}
        {outsideArea && <div role="alert" className="zr-banner zr-banner-red"><GameIcon name="warning" size={17} /> 생존 구역을 벗어났습니다</div>}
        {geoError && <div role="alert" className="zr-banner zr-banner-red"><GameIcon name="warning" size={17} /> {geoError}</div>}
      </div>
      {toastMsg && <div className="zr-toast" role="status" aria-live="polite">{toastMsg}</div>}

      <div className="zr-hud-bottom">
        <button className="zr-map-control" aria-label="내 위치 자동 추적" aria-pressed={follow} onClick={() => setFollow((f) => !f)}>
          <GameIcon name={follow ? 'locate' : 'map'} size={21} />
          <span>{follow ? '추적 중' : '지도 보기'}</span>
        </button>
        <div className="zr-run-state" role="status">
          <small>{runLabel}</small>
          <strong>{gpsPaused ? 'GPS 신호 대기' : frozenActive ? '좀비 정지 · 경로 확보' : threatBand === 'critical' ? threatLabel : paceStatus}</strong>
        </div>
        <button className="zr-exit-control" aria-label="러닝 종료" onClick={finishRun}>
          <GameIcon name="stop" size={18} />
          <span>종료</span>
        </button>
      </div>
    </div>
  )
}
