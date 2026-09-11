import {
  advanceAlongPath, bearingTo, clampToRadius, haversineDistance,
  moveToward, randomPointInDirection, randomPointNear,
} from './geo.js'
import { PACE_PRESETS, DEFAULT_PACE_IDX } from './gameConfig.js'
import { measureMovement, GPS_STALE_MS, HIT_GRACE_MS } from './gameSafety.js'

// Mutable simulation state is owned by App; this module has no React or network effects.
const REROUTE_INTERVAL_MS = 15000 // 좀비 하나당 최소 이 간격마다만 경로 재요청
const REROUTE_MIN_TARGET_SHIFT_M = 60 // 마지막으로 경로를 요청했을 때보다 플레이어가 이만큼 움직이면 재요청

const CATCH_RADIUS_M = 12 // 이 거리 안으로 좀비가 들어오면 붙잡힘
const PICKUP_RADIUS_M = 15 // 이 거리 안으로 걸어가면 아이템 자동 획득
const FIRST_WAVE_SEC = 60
const NEXT_WAVE_SEC = 90
// 러닝을 재밌게 만드는 게 목적이라 좀비 무리 규모는 적당히만 (한 번에 최대 이 마리 수까지만 동시에 존재)
const WAVE_SIZE_MIN = 1
const WAVE_SIZE_MAX = 2
const MAX_CONCURRENT_ZOMBIES = 4
export const START_HEALTH = 6

// 목표보다 느리게 뛰면 좀비가 따라잡고, 유지/추월하면 거리가 벌어지는 방식 (프리셋은 lib/gameConfig.js)
export const LIVE_PACE_WINDOW_MS = 30000 // 실시간 페이스 계산에 쓰는 최근 구간(30초)
export const LIVE_PACE_MIN_WINDOW_SEC = 6 // 이보다 짧은 구간에서는 페이스가 안 흔들리게 표시 안 함

// 제한구역 모드: 시작 위치를 중심으로 반경을 정해서 그 안에서만 좀비/아이템이 등장하고,
// 그 밖에 계속 나가 있으면(누적 시간 기준) 생명이 줄어듦
const OUTSIDE_AREA_HEART_LOSS_MS = 60 * 60 * 1000 // 제한구역 밖에서 누적 이만큼(1시간) 지날 때마다 생명 1개 감소

// 방(그룹) 모드: 각자 따로 좀비를 만나지만, 다른 참가자들의 생존 상태를 주기적으로 공유함
export const ROOM_STAT_PUSH_SEC = 5 // 이 간격마다 내 상태를 방에 올림
export const ROOM_TEAMMATES_POLL_MS = 5000 // 이 간격마다 다른 참가자 상태를 새로 받아옴

// 방향이 중구난방이면 "러닝"이 아니게 되니까, 좀비는 항상 지금 달리는 방향의 뒤쪽에서만 등장시켜서
// 도망치는 방법이 "그냥 계속 앞으로 달리기" 하나로 정해지게 함. 아이템은 반대로 앞쪽에 놓아서
// 계속 전진할 동기를 줌
const HEADING_MIN_STEP_M = 15 // 이만큼 움직여야 "달리는 방향"을 갱신 (GPS 잔떨림 방지)
const ZOMBIE_SPAWN_SPREAD_DEG = 55 // 좀비는 "뒤쪽" 기준 ±이 각도 안에서 스폰
const PICKUP_SPAWN_SPREAD_DEG = 40 // 아이템은 "앞쪽" 기준 ±이 각도 안에서 스폰

// 관리자가 미리 그려둔 좀비 순찰 경로 (src/data/zombieMaps.json). 시작 위치가 그 지도의
// center/radius 안이면 동적 스폰 대신 이 경로를 그대로 씀
const AGGRO_RADIUS_M = 40 // 순찰 중인 좀비가 이 거리 안의 플레이어를 발견하면 추격 시작
const LEASH_DISTANCE_M = 100 // 추격 시작 지점에서 플레이어가 이만큼 멀어지면 좀비가 추격을 포기하고 순찰로 복귀

export function formatTime(totalSec) {
  const m = Math.floor(totalSec / 60)
  const s = Math.floor(totalSec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatPace(mps) {
  if (!mps || mps <= 0) return '-'
  const secPerKm = 1000 / mps
  const rounded = Math.round(secPerKm)
  const m = Math.floor(rounded / 60)
  const s = rounded % 60
  return `${m}'${String(s).padStart(2, '0')}"`
}

export function makeInitialGame() {
  return {
    runId: crypto.randomUUID(),
    lastFix: null,
    movementAnchor: null,
    lastTickAt: 0,
    lastStatAt: 0,
    invulnerableUntil: 0,
    status: 'start', // start | playing | gameover
    playerPos: null,
    lastPos: null,
    distance: 0,
    elapsedSec: 0,
    health: START_HEALTH,
    frozenUntil: 0,
    zombies: [],
    pickups: [],
    waveCount: 0,
    nextWaveSec: FIRST_WAVE_SEC,
    gameOverReason: null,
    targetPaceMps: PACE_PRESETS[DEFAULT_PACE_IDX].mps,
    paceSamples: [], // 실시간 페이스 계산용 { t, d } 샘플 (최근 LIVE_PACE_WINDOW_MS만 유지)
    playMode: 'free', // 'free' | 'restricted'
    areaCenter: null, // 제한구역 모드일 때 시작 위치
    areaRadius: null, // 미터
    outsideAreaMs: 0, // 제한구역 밖에서 누적된 시간(ms)
    outsideAreaHeartsLost: 0, // 그동안 이미 깎은 생명 수 (중복 차감 방지용)
    headingDeg: null, // 지금 달리는 방향 (충분히 움직이기 전까진 null)
    headingAnchor: null, // 방향 계산 기준점
    presetMap: null, // 관리자가 미리 만들어둔 좀비 지도 (해당되면)
    roomId: null, // 방(그룹) 모드일 때만 채워짐
    roomPlayerId: null,
    roomNickname: null,
  }
}

// 헤딩을 아는지에 따라 "뒤쪽"(좀비) 또는 "앞쪽"(아이템) 방향으로 치우친 스폰 지점을 고름
function pickSpawnPoint(game, minM, maxM, { behind } = {}) {
  if (game.headingDeg == null) return randomPointNear(game.playerPos.lat, game.playerPos.lon, minM, maxM)
  const centerBearing = behind ? (game.headingDeg + 180) % 360 : game.headingDeg
  const spread = behind ? ZOMBIE_SPAWN_SPREAD_DEG : PICKUP_SPAWN_SPREAD_DEG
  return randomPointInDirection(game.playerPos.lat, game.playerPos.lon, minM, maxM, centerBearing, spread)
}

// 순찰 좀비를 경로를 따라 speed미터만큼 이동시킴 (끝에 닿으면 반대 방향으로 되돌아가며 왕복)
function stepPatrol(z, dt = 1) {
  let { lat, lon, patrolIndex, patrolDir } = z
  const route = z.patrolRoute
  if (route.length < 2) return { lat, lon, patrolIndex, patrolDir }
  let remaining = z.speed * dt
  let guard = 0
  while (remaining > 0.01 && guard < 20) {
    guard += 1
    const target = route[patrolIndex]
    const d = haversineDistance(lat, lon, target.lat, target.lon)
    if (d > remaining) {
      const next = moveToward(lat, lon, target.lat, target.lon, remaining)
      lat = next.lat
      lon = next.lon
      remaining = 0
    } else {
      lat = target.lat
      lon = target.lon
      remaining -= d
      patrolIndex += patrolDir
      if (patrolIndex >= route.length) {
        patrolIndex = route.length - 2
        patrolDir = -1
      } else if (patrolIndex < 0) {
        patrolIndex = 1
        patrolDir = 1
      }
    }
  }
  return { lat, lon, patrolIndex, patrolDir }
}

// route(좌표 배열)에서 pos와 가장 가까운 점의 인덱스를 찾음 — 순찰 좀비를 경로의 맨 처음이
// 아니라 지금 플레이어 위치에서 가장 가까운 지점부터 시작하게 하려고 씀
export function closestRouteIndex(route, pos) {
  let bestIdx = 0
  let bestDist = Infinity
  route.forEach((p, i) => {
    const d = haversineDistance(pos.lat, pos.lon, p.lat, p.lon)
    if (d < bestDist) {
      bestDist = d
      bestIdx = i
    }
  })
  return bestIdx
}

// 시작 위치가 관리자가 만들어둔 지도의 반경 안이면 그 순찰 경로로 좀비를 배치하고,
// 아니면 기존 방식(자유/제한구역 모드 + 동적 스폰)을 그대로 씀
export function applyStartSetup(game, startPos, { paceMps, playMode, radiusM, zombieMaps, forcedMap }) {
  game.targetPaceMps = paceMps
  const matched =
    forcedMap ||
    zombieMaps.find((m) => haversineDistance(startPos.lat, startPos.lon, m.center.lat, m.center.lon) <= m.radius)
  if (matched) {
    game.presetMap = matched
    game.playMode = 'restricted'
    game.areaCenter = matched.center
    game.areaRadius = matched.radius
    game.zombies = matched.routes.map((route, i) => {
      // 경로의 맨 처음 점이 아니라, 지금 내 위치에서 가장 가까운 지점부터 순찰을 시작하게 함
      const startIdx = closestRouteIndex(route, startPos)
      const patrolDir = startIdx >= route.length - 1 ? -1 : 1
      return {
        id: `preset_${matched.id}_${i}_${Date.now()}`,
        lat: route[startIdx].lat,
        lon: route[startIdx].lon,
        speed: paceMps * (0.9 + Math.random() * 0.2),
        path: null,
        pathFetchedFor: null,
        lastRouteAt: 0,
        routing: false,
        patrolRoute: route,
        patrolIndex: route.length > 1 ? startIdx + patrolDir : startIdx,
        patrolDir,
        state: 'patrol',
        chaseHome: null,
      }
    })
  } else {
    game.presetMap = null
    game.playMode = playMode
    if (playMode === 'restricted') {
      game.areaCenter = startPos
      game.areaRadius = radiusM
    }
  }
  return matched
}


function spawnWave(game, now, emit) {
    if (!game.playerPos) return
    const room = MAX_CONCURRENT_ZOMBIES - game.zombies.length
    if (room <= 0) return
    const count = Math.min(room, WAVE_SIZE_MIN + Math.floor(Math.random() * (WAVE_SIZE_MAX - WAVE_SIZE_MIN + 1)))
    const spawned = []
    for (let i = 0; i < count; i++) {
      let p = pickSpawnPoint(game, 70, 150, { behind: true })
      if (game.playMode === 'restricted' && game.areaCenter) p = clampToRadius(p, game.areaCenter, game.areaRadius)
      spawned.push({
        id: `z${now}_${i}_${Math.random().toString(36).slice(2, 7)}`,
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
    emit(`좀비 무리 등장! (${count}마리) 🧟`)
}

function spawnPickup(game, now) {
  if (!game.playerPos) return
  let p = pickSpawnPoint(game, 30, 90, { behind: false })
  if (game.playMode === 'restricted' && game.areaCenter)
    p = clampToRadius(p, game.areaCenter, game.areaRadius)
  game.pickups = [...game.pickups, { id: 'hourglass_' + now, type: 'hourglass', lat: p.lat, lon: p.lon }]
}

export function advanceGame(game, dt, now) {
  const messages = []
  const emit = message => messages.push(message)
  if (game.status !== 'playing' || !Number.isFinite(dt) || dt <= 0)
    return { messages, endReason: null }
    game.elapsedSec += dt
    const frozen = now < game.frozenUntil

    if (!game.presetMap && game.playerPos && game.elapsedSec >= game.nextWaveSec) {
      spawnWave(game, now, emit)
      game.waveCount += 1
      game.nextWaveSec = game.elapsedSec + NEXT_WAVE_SEC
    }

    if (game.playerPos && Math.floor(game.elapsedSec / 70) > Math.floor((game.elapsedSec - dt) / 70) && !game.pickups.some((p) => p.type === 'hourglass')) {
      spawnPickup(game, now)
    }

    if (!frozen && game.playerPos && game.zombies.length) {
      game.zombies = game.zombies.map((z) => {
        if (z.patrolRoute) {
          const distToPlayer = haversineDistance(game.playerPos.lat, game.playerPos.lon, z.lat, z.lon)
          if (z.state === 'patrol') {
            if (distToPlayer <= AGGRO_RADIUS_M) return { ...z, state: 'chase', chaseHome: { lat: z.lat, lon: z.lon } }
            const { lat, lon, patrolIndex, patrolDir } = stepPatrol(z, dt)
            return { ...z, lat, lon, patrolIndex, patrolDir }
          }
          // state === 'chase'
          const leashDist = haversineDistance(game.playerPos.lat, game.playerPos.lon, z.chaseHome.lat, z.chaseHome.lon)
          if (leashDist > LEASH_DISTANCE_M) {
            return { ...z, state: 'patrol', path: null, pathFetchedFor: null, lastRouteAt: 0 }
          }
          if (z.path && z.path.length > 1) {
            const { pos, path } = advanceAlongPath(z.path, z.speed * dt)
            return { ...z, lat: pos.lat, lon: pos.lon, path }
          }
          const next = moveToward(z.lat, z.lon, game.playerPos.lat, game.playerPos.lon, z.speed * dt)
          return { ...z, lat: next.lat, lon: next.lon }
        }
        if (z.path && z.path.length > 1) {
          const { pos, path } = advanceAlongPath(z.path, z.speed * dt)
          return { ...z, lat: pos.lat, lon: pos.lon, path }
        }
        const next = moveToward(z.lat, z.lon, game.playerPos.lat, game.playerPos.lon, z.speed * dt)
        return { ...z, lat: next.lat, lon: next.lon }
      })


    }

    if (!frozen && now >= game.invulnerableUntil && game.playerPos && game.zombies.length) {
      let caught = false
      const survivors = []
      for (const z of game.zombies) {
        const d = haversineDistance(game.playerPos.lat, game.playerPos.lon, z.lat, z.lon)
        if (d < CATCH_RADIUS_M) {
          caught = true
          if (z.patrolRoute) {
            survivors.push({ ...z, state: 'patrol', path: null, pathFetchedFor: null, lastRouteAt: 0 })
          } else {
            let far = pickSpawnPoint(game, 90, 160, { behind: true })
            if (game.playMode === 'restricted') far = clampToRadius(far, game.areaCenter, game.areaRadius)
            survivors.push({ ...z, lat: far.lat, lon: far.lon, path: null, pathFetchedFor: null, lastRouteAt: 0 })
          }
        } else {
          survivors.push(z)
        }
      }
      if (caught) {
        game.zombies = survivors
        game.health -= 1
        game.invulnerableUntil = now + HIT_GRACE_MS
        emit('좀비에게 붙잡혔어요! 💔')
        if (game.health <= 0) {
          return { messages, endReason: 'caught' }
        }
      }
    }

    if (game.playerPos && game.pickups.length) {
      const remaining = []
      for (const p of game.pickups) {
        const d = haversineDistance(game.playerPos.lat, game.playerPos.lon, p.lat, p.lon)
        if (d < PICKUP_RADIUS_M) {
          game.frozenUntil = now + 10000
          emit('모래시계 발동! 좀비가 10초간 멈춰요 ⏳')
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
        game.outsideAreaMs += dt * 1000
        const shouldHaveLost = Math.floor(game.outsideAreaMs / OUTSIDE_AREA_HEART_LOSS_MS)
        if (shouldHaveLost > game.outsideAreaHeartsLost) {
          const lose = shouldHaveLost - game.outsideAreaHeartsLost
          game.outsideAreaHeartsLost = shouldHaveLost
          game.health -= lose
          emit('제한구역을 너무 오래 벗어나 있어서 생명이 줄었어요 💔')
          if (game.health <= 0) {
            return { messages, endReason: 'outside_area' }
          }
        }
      }
    }


  return { messages, endReason: null }
}

export function findRouteCandidate(game, now) {
  if (!game.playerPos || now < game.frozenUntil) return null
  return game.zombies.find((z) => {
        if (z.patrolRoute && z.state !== 'chase') return false
        if (z.routing) return false
        const stale = now - z.lastRouteAt > REROUTE_INTERVAL_MS
        const shifted = !z.pathFetchedFor ||
          haversineDistance(z.pathFetchedFor.lat, z.pathFetchedFor.lon, game.playerPos.lat, game.playerPos.lon) >
            REROUTE_MIN_TARGET_SHIFT_M
        return stale && (shifted || !z.path || z.path.length < 2)
      })

}

export function updatePosition(game, fix, now) {
    const movement = measureMovement(game.movementAnchor, fix)
    const gap = !game.lastFix || fix.t - game.lastFix.t > GPS_STALE_MS
    if (!gap && movement) game.distance += movement
    if (gap || movement || !game.movementAnchor || fix.t - game.movementAnchor.t > GPS_STALE_MS)
      game.movementAnchor = fix
    game.lastFix = fix
    game.lastPos = fix
    game.playerPos = fix
    game.paceSamples = [...game.paceSamples, { t: now, d: game.distance }]
      .filter(sample => now - sample.t <= LIVE_PACE_WINDOW_MS)
    if (!game.headingAnchor || gap) game.headingAnchor = fix
    else if (haversineDistance(game.headingAnchor.lat, game.headingAnchor.lon, fix.lat, fix.lon) >= HEADING_MIN_STEP_M) {
      game.headingDeg = bearingTo(game.headingAnchor.lat, game.headingAnchor.lon, fix.lat, fix.lon)
      game.headingAnchor = fix
    }

}
