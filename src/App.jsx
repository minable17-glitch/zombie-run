import { useCallback, useEffect, useRef, useState } from 'react'
import GameMap from './GameMap.jsx'
import { advanceAlongPath, clampToRadius, haversineDistance, moveToward, randomPointNear } from './lib/geo.js'
import { fetchWalkingPath } from './lib/routing.js'

// OpenRouteService 키가 있으면 좀비가 실제 도로/인도 경로를 따라 쫓아오고,
// 없으면(또는 요청 실패 시) 자동으로 직선 이동으로 대체됨
const ORS_API_KEY = import.meta.env.VITE_ORS_API_KEY
const REROUTE_INTERVAL_MS = 15000 // 좀비 하나당 최소 이 간격마다만 경로 재요청
const REROUTE_MIN_TARGET_SHIFT_M = 60 // 마지막으로 경로를 요청했을 때보다 플레이어가 이만큼 움직이면 재요청

const CATCH_RADIUS_M = 12 // 이 거리 안으로 좀비가 들어오면 붙잡힘
const SHOOT_RADIUS_M = 35 // 이 거리 안의 좀비만 탭해서 처치 가능
const PICKUP_RADIUS_M = 15 // 이 거리 안으로 걸어가면 아이템 자동 획득
const ULTIMATE_RADIUS_M = 200 // 궁극기가 미치는 범위
const FIRST_WAVE_SEC = 60
const NEXT_WAVE_SEC = 90
// 러닝을 재밌게 만드는 게 목적이라 좀비 무리 규모는 적당히만 (한 번에 최대 이 마리 수까지만 동시에 존재)
const WAVE_SIZE_MIN = 1
const WAVE_SIZE_MAX = 2
const MAX_CONCURRENT_ZOMBIES = 4
const START_AMMO = 3
const MAX_AMMO = 12
const START_HEALTH = 6

// 좀비 속도 = 선택한 목표 페이스(분:초/km)를 그대로 m/s로 환산한 값 (개체별로 살짝 편차를 줌)
// 목표보다 느리게 뛰면 좀비가 따라잡고, 유지/추월하면 거리가 벌어지는 방식
const PACE_PRESETS = [
  { label: "5'30\"/km", secPerKm: 5 * 60 + 30 },
  { label: "6'00\"/km", secPerKm: 6 * 60 },
  { label: "6'30\"/km", secPerKm: 6 * 60 + 30 },
  { label: "7'00\"/km", secPerKm: 7 * 60 },
].map((p) => ({ ...p, mps: 1000 / p.secPerKm }))
const DEFAULT_PACE_IDX = 1

const LIVE_PACE_WINDOW_MS = 30000 // 실시간 페이스 계산에 쓰는 최근 구간(30초)
const LIVE_PACE_MIN_WINDOW_SEC = 6 // 이보다 짧은 구간에서는 페이스가 안 흔들리게 표시 안 함

// 제한구역 모드: 시작 위치를 중심으로 반경을 정해서 그 안에서만 좀비/아이템이 등장하고,
// 그 밖에 계속 나가 있으면(누적 시간 기준) 생명이 줄어듦
const AREA_RADIUS_PRESETS = [300, 500, 1000, 2000] // 미터
const DEFAULT_RADIUS_IDX = 1
const OUTSIDE_AREA_HEART_LOSS_MS = 60 * 60 * 1000 // 제한구역 밖에서 누적 이만큼(1시간) 지날 때마다 생명 1개 감소

function formatTime(totalSec) {
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatDistance(meters) {
  if (meters < 1000) return `${Math.round(meters)}m`
  return `${(meters / 1000).toFixed(2)}km`
}

function formatPace(mps) {
  if (!mps || mps <= 0) return '-'
  const secPerKm = 1000 / mps
  const m = Math.floor(secPerKm / 60)
  const s = Math.round(secPerKm % 60)
  return `${m}'${String(s).padStart(2, '0')}"`
}

function makeInitialGame() {
  return {
    status: 'start', // start | playing | gameover
    playerPos: null,
    lastPos: null,
    distance: 0,
    elapsedSec: 0,
    ammo: START_AMMO,
    health: START_HEALTH,
    score: 0,
    gauge: 0,
    frozenUntil: 0,
    zombies: [],
    pickups: [],
    waveCount: 0,
    nextWaveSec: FIRST_WAVE_SEC,
    ultimateCooldownUntil: 0,
    gameOverReason: null,
    targetPaceMps: PACE_PRESETS[DEFAULT_PACE_IDX].mps,
    paceSamples: [], // 실시간 페이스 계산용 { t, d } 샘플 (최근 LIVE_PACE_WINDOW_MS만 유지)
    playMode: 'free', // 'free' | 'restricted'
    areaCenter: null, // 제한구역 모드일 때 시작 위치
    areaRadius: null, // 미터
    outsideAreaMs: 0, // 제한구역 밖에서 누적된 시간(ms)
    outsideAreaHeartsLost: 0, // 그동안 이미 깎은 생명 수 (중복 차감 방지용)
  }
}

export default function App() {
  const game = useRef(makeInitialGame()).current
  const [, setTick] = useState(0)
  const rerender = useCallback(() => setTick((n) => n + 1), [])

  const [geoError, setGeoError] = useState('')
  const [follow, setFollow] = useState(true)
  const [paceIdx, setPaceIdx] = useState(DEFAULT_PACE_IDX)
  const [playMode, setPlayMode] = useState('free')
  const [radiusIdx, setRadiusIdx] = useState(DEFAULT_RADIUS_IDX)
  const [toastMsg, setToastMsg] = useState('')
  const toastTimerRef = useRef(null)
  const watchIdRef = useRef(null)
  const tickIntervalRef = useRef(null)

  const toast = useCallback((msg) => {
    setToastMsg(msg)
    clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToastMsg(''), 2600)
  }, [])

  const spawnWave = useCallback(() => {
    if (!game.playerPos) return
    const room = MAX_CONCURRENT_ZOMBIES - game.zombies.length
    if (room <= 0) return
    const count = Math.min(room, WAVE_SIZE_MIN + Math.floor(Math.random() * (WAVE_SIZE_MAX - WAVE_SIZE_MIN + 1)))
    const spawned = []
    for (let i = 0; i < count; i++) {
      let p = randomPointNear(game.playerPos.lat, game.playerPos.lon, 70, 150)
      if (game.playMode === 'restricted' && game.areaCenter) p = clampToRadius(p, game.areaCenter, game.areaRadius)
      spawned.push({
        id: `z${Date.now()}_${i}_${Math.random().toString(36).slice(2, 7)}`,
        lat: p.lat,
        lon: p.lon,
        speed: game.targetPaceMps * (0.9 + Math.random() * 0.2), // 목표 페이스 ±10% 편차 (1틱=1초라 그대로 스텝 거리로 씀)
        path: null, // 도로 경로 좌표 배열 (아직 없으면 직선 이동)
        pathFetchedFor: null, // 이 경로를 요청했을 때의 플레이어 위치
        lastRouteAt: 0,
        routing: false,
      })
    }
    game.zombies = [...game.zombies, ...spawned]
    toast(`좀비 무리 등장! (${count}마리) 🧟`)
  }, [game, toast])

  const spawnPickup = useCallback(
    (type) => {
      if (!game.playerPos) return
      let p = randomPointNear(game.playerPos.lat, game.playerPos.lon, 30, 90)
      if (game.playMode === 'restricted' && game.areaCenter) p = clampToRadius(p, game.areaCenter, game.areaRadius)
      game.pickups = [...game.pickups, { id: `${type}_${Date.now()}`, type, lat: p.lat, lon: p.lon }]
    },
    [game]
  )

  const endGame = useCallback(
    (reason) => {
      game.status = 'gameover'
      game.gameOverReason = reason
      clearInterval(tickIntervalRef.current)
      rerender()
    },
    [game, rerender]
  )

  const tick = useCallback(() => {
    if (game.status !== 'playing') return
    game.elapsedSec += 1
    const now = Date.now()
    const frozen = now < game.frozenUntil

    if (game.playerPos && game.elapsedSec >= game.nextWaveSec) {
      spawnWave()
      game.waveCount += 1
      game.nextWaveSec = game.elapsedSec + NEXT_WAVE_SEC
    }

    if (game.playerPos && game.elapsedSec % 45 === 0 && !game.pickups.some((p) => p.type === 'ammo')) {
      spawnPickup('ammo')
    }
    if (game.playerPos && game.elapsedSec % 70 === 0 && !game.pickups.some((p) => p.type === 'hourglass')) {
      spawnPickup('hourglass')
    }

    if (!frozen && game.playerPos && game.zombies.length) {
      game.zombies = game.zombies.map((z) => {
        if (z.path && z.path.length > 1) {
          const { pos, path } = advanceAlongPath(z.path, z.speed)
          return { ...z, lat: pos.lat, lon: pos.lon, path }
        }
        const next = moveToward(z.lat, z.lon, game.playerPos.lat, game.playerPos.lon, z.speed)
        return { ...z, lat: next.lat, lon: next.lon }
      })

      // 레이트리밋을 지키려고 틱마다 최대 한 마리씩만 경로 재요청 (안 되면 그동안 직선 이동으로 대체됨)
      const needsRoute = game.zombies.find((z) => {
        if (z.routing) return false
        const stale = now - z.lastRouteAt > REROUTE_INTERVAL_MS
        const shifted = !z.pathFetchedFor ||
          haversineDistance(z.pathFetchedFor.lat, z.pathFetchedFor.lon, game.playerPos.lat, game.playerPos.lon) >
            REROUTE_MIN_TARGET_SHIFT_M
        return stale || shifted
      })
      if (needsRoute && ORS_API_KEY) {
        const targetId = needsRoute.id
        const targetPos = { lat: game.playerPos.lat, lon: game.playerPos.lon }
        const fromPos = { lat: needsRoute.lat, lon: needsRoute.lon }
        game.zombies = game.zombies.map((z) => (z.id === targetId ? { ...z, routing: true } : z))
        fetchWalkingPath(ORS_API_KEY, fromPos, targetPos).then((path) => {
          game.zombies = game.zombies.map((z) => {
            if (z.id !== targetId) return z
            if (path) return { ...z, path, pathFetchedFor: targetPos, lastRouteAt: Date.now(), routing: false }
            return { ...z, routing: false, lastRouteAt: Date.now() }
          })
          rerender()
        })
      }
    }

    if (game.playerPos && game.zombies.length) {
      let caught = false
      const survivors = []
      for (const z of game.zombies) {
        const d = haversineDistance(game.playerPos.lat, game.playerPos.lon, z.lat, z.lon)
        if (d < CATCH_RADIUS_M) {
          caught = true
          const far = randomPointNear(game.playerPos.lat, game.playerPos.lon, 90, 160)
          survivors.push({ ...z, lat: far.lat, lon: far.lon, path: null, pathFetchedFor: null, lastRouteAt: 0 })
        } else {
          survivors.push(z)
        }
      }
      if (caught) {
        game.zombies = survivors
        game.health -= 1
        toast('좀비에게 붙잡혔어요! 💔')
        if (game.health <= 0) {
          endGame('caught')
          return
        }
      }
    }

    if (game.playerPos && game.pickups.length) {
      const remaining = []
      for (const p of game.pickups) {
        const d = haversineDistance(game.playerPos.lat, game.playerPos.lon, p.lat, p.lon)
        if (d < PICKUP_RADIUS_M) {
          if (p.type === 'ammo') {
            game.ammo = Math.min(MAX_AMMO, game.ammo + 4)
            toast('탄약 상자 발견! +4 🔫')
          } else {
            game.frozenUntil = Date.now() + 10000
            toast('모래시계 발동! 좀비가 10초간 멈춰요 ⏳')
          }
        } else {
          remaining.push(p)
        }
      }
      game.pickups = remaining
    }

    if (game.playMode === 'restricted' && game.areaCenter && game.playerPos) {
      const distFromCenter = haversineDistance(
        game.areaCenter.lat,
        game.areaCenter.lon,
        game.playerPos.lat,
        game.playerPos.lon
      )
      if (distFromCenter > game.areaRadius) {
        game.outsideAreaMs += 1000
        const shouldHaveLost = Math.floor(game.outsideAreaMs / OUTSIDE_AREA_HEART_LOSS_MS)
        if (shouldHaveLost > game.outsideAreaHeartsLost) {
          const lose = shouldHaveLost - game.outsideAreaHeartsLost
          game.outsideAreaHeartsLost = shouldHaveLost
          game.health -= lose
          toast('제한구역을 너무 오래 벗어나 있어서 생명이 줄었어요 💔')
          if (game.health <= 0) {
            endGame('outside_area')
            return
          }
        }
      }
    }

    rerender()
  }, [game, rerender, spawnWave, spawnPickup, toast, endGame])

  const handlePosition = useCallback(
    (pos) => {
      const newPos = { lat: pos.coords.latitude, lon: pos.coords.longitude }
      if (game.status === 'playing' && game.lastPos) {
        const d = haversineDistance(game.lastPos.lat, game.lastPos.lon, newPos.lat, newPos.lon)
        if (d >= 0.5 && d <= 30) {
          game.distance += d
          game.gauge = Math.min(100, game.gauge + d * 0.15)
        }
      }
      game.lastPos = newPos
      game.playerPos = newPos
      if (game.status === 'playing') {
        const now = Date.now()
        game.paceSamples = [...game.paceSamples, { t: now, d: game.distance }].filter(
          (s) => now - s.t <= LIVE_PACE_WINDOW_MS
        )
      }
      setGeoError('')
      rerender()
    },
    [game, rerender]
  )

  useEffect(() => {
    return () => {
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current)
      clearInterval(tickIntervalRef.current)
      clearTimeout(toastTimerRef.current)
    }
  }, [])

  const requestLocationAndStart = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setGeoError('이 기기/브라우저는 위치 정보를 지원하지 않아요.')
      return
    }
    setGeoError('')
    if (watchIdRef.current == null) {
      watchIdRef.current = navigator.geolocation.watchPosition(
        handlePosition,
        (err) => setGeoError(err.message || '위치 권한을 확인해주세요.'),
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 }
      )
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const startPos = { lat: pos.coords.latitude, lon: pos.coords.longitude }
        Object.assign(game, makeInitialGame())
        game.status = 'playing'
        game.playerPos = startPos
        game.lastPos = startPos
        game.targetPaceMps = PACE_PRESETS[paceIdx].mps
        game.playMode = playMode
        if (playMode === 'restricted') {
          game.areaCenter = startPos
          game.areaRadius = AREA_RADIUS_PRESETS[radiusIdx]
        }
        tickIntervalRef.current = setInterval(tick, 1000)
        rerender()
      },
      (err) => setGeoError(err.message || '위치 권한이 필요해요.'),
      { enableHighAccuracy: true, timeout: 20000 }
    )
  }, [game, handlePosition, tick, rerender, paceIdx, playMode, radiusIdx])

  const shootZombie = useCallback(
    (id) => {
      if (game.status !== 'playing') return
      if (game.ammo <= 0) {
        toast('탄약이 없어요! 탄약 상자를 찾아보세요 📦')
        return
      }
      const z = game.zombies.find((zz) => zz.id === id)
      if (!z || !game.playerPos) return
      const d = haversineDistance(game.playerPos.lat, game.playerPos.lon, z.lat, z.lon)
      if (d > SHOOT_RADIUS_M) {
        toast(`너무 멀어요! (${Math.round(d)}m)`)
        return
      }
      game.zombies = game.zombies.filter((zz) => zz.id !== id)
      game.ammo -= 1
      game.score += 1
      toast('좀비 처치! 💀')
      rerender()
    },
    [game, toast, rerender]
  )

  const useUltimate = useCallback(() => {
    if (game.status !== 'playing') return
    if (game.gauge < 100) return
    const now = Date.now()
    if (now < game.ultimateCooldownUntil) return
    if (!game.playerPos) return
    let killed = 0
    game.zombies = game.zombies.filter((z) => {
      const d = haversineDistance(game.playerPos.lat, game.playerPos.lon, z.lat, z.lon)
      const inRange = d <= ULTIMATE_RADIUS_M
      if (inRange) killed += 1
      return !inRange
    })
    game.gauge = 0
    game.ultimateCooldownUntil = now + 5000
    game.score += killed
    toast(killed > 0 ? `궁극기 발동! 좀비 ${killed}마리 제거! ⚡` : '궁극기 발동! (주변에 좀비가 없어요)')
    rerender()
  }, [game, toast, rerender])

  const finishRun = useCallback(() => endGame('manual'), [endGame])

  const restart = useCallback(() => {
    const keepPos = game.playerPos
    Object.assign(game, makeInitialGame())
    game.playerPos = keepPos
    game.lastPos = keepPos
    game.status = 'playing'
    game.targetPaceMps = PACE_PRESETS[paceIdx].mps
    game.playMode = playMode
    if (playMode === 'restricted' && keepPos) {
      game.areaCenter = keepPos
      game.areaRadius = AREA_RADIUS_PRESETS[radiusIdx]
    }
    tickIntervalRef.current = setInterval(tick, 1000)
    rerender()
  }, [game, tick, rerender, paceIdx, playMode, radiusIdx])

  const backToStart = useCallback(() => {
    const keepPos = game.playerPos
    Object.assign(game, makeInitialGame())
    game.playerPos = keepPos
    game.lastPos = keepPos
    rerender()
  }, [game, rerender])

  if (game.status === 'start') {
    return (
      <div className="zr-screen zr-start">
        <div className="zr-start-card">
          <h1 className="zr-title">🧟 좀비 런</h1>
          <p className="zr-subtitle">실제 GPS를 쓰기 때문에, 살아남는 방법은 진짜로 뛰는 것뿐입니다.</p>
          <ul className="zr-rules">
            <li>러닝 시작 60초 뒤, 좀비 무리 등장</li>
            <li>기본 총알 3발</li>
            <li>좀비를 탭해서 처치 (가까이 있어야 함)</li>
            <li>탄약 상자(📦)로 재장전</li>
            <li>모래시계(⏳) 아이템으로 좀비 10초간 정지</li>
            <li>달릴수록 게이지가 차서 궁극기 발동</li>
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
          <button className="zr-btn zr-btn-primary" onClick={requestLocationAndStart}>
            도망치기 시작 🏃
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
          <div className="zr-result-grid">
            <div>
              <div className="zr-result-num">{formatTime(game.elapsedSec)}</div>
              <div className="zr-result-label">생존 시간</div>
            </div>
            <div>
              <div className="zr-result-num">{formatDistance(game.distance)}</div>
              <div className="zr-result-label">달린 거리</div>
            </div>
            <div>
              <div className="zr-result-num">{game.score}</div>
              <div className="zr-result-label">처치한 좀비</div>
            </div>
          </div>
          <button className="zr-btn zr-btn-primary" onClick={restart}>
            다시 도전하기
          </button>
          <button className="zr-btn zr-btn-ghost" onClick={backToStart}>
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
  const ultimateReady = game.gauge >= 100 && Date.now() >= game.ultimateCooldownUntil
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
        onShootZombie={shootZombie}
        follow={follow}
        areaCenter={game.areaCenter}
        areaRadius={game.areaRadius}
      />

      <div className="zr-hud-side">
        <div className="zr-badge">🔫 {game.ammo}</div>
        <div className="zr-hearts">
          {Array.from({ length: START_HEALTH }).map((_, i) => (
            <span key={i} className={i < game.health ? 'zr-heart zr-heart-on' : 'zr-heart'}>
              ❤️
            </span>
          ))}
        </div>
        <button
          className={ultimateReady ? 'zr-gauge zr-gauge-ready' : 'zr-gauge'}
          onClick={useUltimate}
          disabled={!ultimateReady}
        >
          ⚡{Math.floor(game.gauge)}
        </button>
        <div className="zr-badge">💀 {game.score}</div>
      </div>

      <div className="zr-banner-stack">
        {frozenActive && <div className="zr-banner zr-banner-blue">⏳ 좀비 이동 정지 중</div>}
        {outsideArea && <div className="zr-banner zr-banner-red">⚠️ 제한구역을 벗어났어요</div>}
        {geoError && <div className="zr-banner zr-banner-red">{geoError}</div>}
      </div>
      {toastMsg && <div className="zr-toast">{toastMsg}</div>}

      <div className="zr-hud-bottom">
        <button className="zr-round-btn" onClick={() => setFollow((f) => !f)}>
          {follow ? '📍' : '🗺️'}
        </button>
        <button className="zr-btn zr-btn-ghost zr-btn-small" onClick={finishRun}>
          종료
        </button>
      </div>
    </div>
  )
}
