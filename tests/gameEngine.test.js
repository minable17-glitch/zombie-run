import { test, expect } from 'vitest'
import {
  advanceGame, applyStartSetup, makeInitialGame, updatePosition, summonFirstWave, turnAround,
  startPause, endPause, checkPauseAutoResume, pauseStatus, SCHOOL_PAUSE_BUDGET_SEC, SCHOOL_PAUSE_AUTO_RESUME_MS,
  computeLivePaceMps, paceDiffSec, paceZone, PACE_KIND, PACE_ENERGY_START, PACE_ENERGY_MAX, PACE_SCORE_MAX_PER_SEC,
} from '../src/lib/gameEngine.js'
import { haversineDistance } from '../src/lib/geo.js'
import { insidePolygon } from '../src/lib/playArea.js'

function playing() {
  return { ...makeInitialGame(), status: 'playing', playerPos: { lat: 37, lon: 127 } }
}

test('turnaround moves pursuers to the opposite side without changing score and prevents repeated taps', () => {
 const g=playing(); g.headingDeg=0
 g.zombies=[{id:'z',lat:36.999,lon:127,speed:2,path:[g.playerPos],routing:true}]
 expect(turnAround(g,10000)).toBe(true)
 expect(g.zombies[0].lat).toBeGreaterThan(37)
 expect(g.zombies[0].path).toBeNull()
 expect(g.zombies[0].routing).toBe(false)
 expect(g.headingDeg).toBe(180)
 expect(g.elapsedSec).toBe(0)
 expect(g.distance).toBe(0)
 expect(turnAround(g,10001)).toBe(false)
 const before=g.zombies[0].lat
 advanceGame(g,1,11000)
 expect(g.zombies[0].lat).toBeLessThan(before)
})

test('turnaround on a saved route stays on that route and reverses pursuit direction', () => {
 const g=playing(); g.playerPos={lat:37.005,lon:127}; g.headingDeg=0
 const route=[{lat:37,lon:127},{lat:37.01,lon:127}]
 applyStartSetup(g,g.playerPos,{paceMps:2,forcedMap:{id:'route',center:g.playerPos,radius:1000,routes:[route]}})
 expect(turnAround(g,10000)).toBe(true)
 expect(g.zombies[0].patrolRoute).toBe(route)
 expect(g.zombies[0].lat).toBeGreaterThan(g.playerPos.lat)
 expect(g.zombies[0].lon).toBe(127)
 expect(g.zombies[0].patrolDir).toBe(-1)
})

test('early summon is one-shot and schedules the next wave from summon time', () => {
  const game=playing()
  game.elapsedSec=10
  expect(summonFirstWave(game,10000)).toBe(true)
  const count=game.zombies.length
  expect(summonFirstWave(game,10001)).toBe(false)
  expect(game.zombies).toHaveLength(count)
  expect(game.elapsedSec).toBe(10)
  expect(game.nextWaveSec).toBe(100)
  expect(summonFirstWave({...playing(),presetMap:{}},10000)).toBe(false)
  expect(summonFirstWave({...playing(),roomId:'room'},10000)).toBe(false)
})

test('polygon runs enforce their boundary and keep pickups inside the authored area', () => {
  const game=playing()
  const boundary=[{lat:37,lon:127},{lat:37.002,lon:127},{lat:37,lon:127.002}]
  const route=[{lat:37.0001,lon:127.0001},{lat:37.0002,lon:127.0001}]
  const map={id:'triangle',center:{lat:37.001,lon:127.001},radius:400,boundary,routes:[route]}
  applyStartSetup(game,route[0],{paceMps:2,forcedMap:map})
  game.playerPos={lat:37.0018,lon:127.0018}
  game.outsideAreaMs=3599000
  game.elapsedSec=69
  advanceGame(game,1,70000)
  expect(game.health).toBe(5)
  expect(game.pickups).toHaveLength(1)
  expect(insidePolygon(game.pickups[0],boundary)).toBe(true)
  applyStartSetup(game,route[0],{paceMps:2,playMode:'free',radiusM:400})
  expect(game.areaBoundary).toBeNull()
})

test('frozen zombies cannot move or damage the player until the freeze ends', () => {
  const game = playing()
  game.health = 1
  game.frozenUntil = 10000
  game.zombies = [{ id: 'z', lat: 37, lon: 127, speed: 2 }]
  expect(advanceGame(game, 1, 9000).endReason).toBeNull()
  expect(game.health).toBe(1)
  expect(game.zombies[0]).toMatchObject({ lat: 37, lon: 127 })
  expect(advanceGame(game, 1, 10000).endReason).toBe('caught')
  expect(game.health).toBe(0)
})

test('waves respect the concurrent zombie limit', () => {
  const game = playing()
  game.elapsedSec = 59
  game.zombies = Array.from({ length: 3 }, (_, id) => ({ id, lat: 38, lon: 127, speed: 0 }))
  advanceGame(game, 1, 60000)
  expect(game.zombies).toHaveLength(4)
  advanceGame(game, 90, 150000)
  expect(game.zombies).toHaveLength(4)
})

test('outside-area penalties occur once per accumulated hour', () => {
  const game = playing()
  Object.assign(game, {
    playMode: 'restricted', areaCenter: { lat: 38, lon: 127 },
    areaRadius: 100, outsideAreaMs: 3599000, nextWaveSec: Infinity,
  })
  advanceGame(game, 1, 1000)
  expect(game.health).toBe(5)
  advanceGame(game, 1, 2000)
  expect(game.health).toBe(5)
  expect(game.outsideAreaHeartsLost).toBe(1)
})

test('a selected map keeps zombies on the authored route instead of chasing the runner', () => {
  const game = playing()
  const route = [{ lat: 37, lon: 127 }, { lat: 37.001, lon: 127 }]
  const map = { id: 'map', name: '공원', center: { lat: 37, lon: 127 }, radius: 400, routes: [route] }
  const selected = applyStartSetup(game, game.playerPos, {
    paceMps: 2, playMode: 'free', radiusM: 100, forcedMap: map,
  })
  expect(selected).toBe(map)
  expect(game.presetMap).toBe(map)
  expect(game.areaRadius).toBe(400)
  game.playerPos = { lat: 37, lon: 127.002 }
  const before = game.zombies[0]
  advanceGame(game, 1, 1000)
  expect(game.zombies[0].state).toBe('patrol')
  expect(game.zombies[0].lat).toBeGreaterThan(before.lat)
  expect(game.zombies[0].lon).toBe(127)
  game.elapsedSec = 59
  advanceGame(game, 1, 60000)
  expect(game.zombies).toHaveLength(1)
  expect(game.waveCount).toBe(0)
})

test.each(['free', 'restricted'])('starting %s without selecting a map clears previous patrols and chases the runner', (playMode) => {
  const game = playing()
  const startPos = game.playerPos
  const map = {
    id: 'map', center: startPos, radius: 400,
    routes: [[startPos, { lat: 37.001, lon: 127 }]],
  }
  applyStartSetup(game, startPos, { paceMps: 2, forcedMap: map })
  expect(game.zombies[0].patrolRoute).toBe(map.routes[0])

  const selected = applyStartSetup(game, startPos, { paceMps: 2, playMode, radiusM: 200 })
  expect(selected).toBeNull()
  expect(game.presetMap).toBeNull()
  expect(game.playMode).toBe(playMode)
  expect(game.areaCenter).toEqual(playMode === 'restricted' ? startPos : null)
  expect(game.areaRadius).toBe(playMode === 'restricted' ? 200 : null)
  expect(game.zombies).toHaveLength(0)

  game.elapsedSec = 59
  advanceGame(game, 1, 60000)
  expect(game.zombies.length).toBeGreaterThan(0)
  expect(game.zombies.every(zombie => !zombie.patrolRoute)).toBe(true)
  // Move away from the old route: dynamic zombies must target the new player position.
  game.playerPos = { lat: 37, lon: 127.002 }
  const distances = game.zombies.map(zombie =>
    haversineDistance(zombie.lat, zombie.lon, game.playerPos.lat, game.playerPos.lon))
  advanceGame(game, 1, 61000)
  game.zombies.forEach((zombie, index) => {
    const distance = haversineDistance(zombie.lat, zombie.lon, game.playerPos.lat, game.playerPos.lon)
    expect(distances[index] - distance).toBeCloseTo(zombie.speed, 4)
  })
})

test('collecting an hourglass removes it and freezes zombies for ten seconds', () => {
  const game = playing()
  game.nextWaveSec = Infinity
  game.pickups = [{ id: 'hourglass', type: 'hourglass', lat: 37, lon: 127 }]
  const { messages } = advanceGame(game, 1, 1000)
  expect(game.pickups).toHaveLength(0)
  expect(game.frozenUntil).toBe(11000)
  expect(messages.some((message) => message.includes('모래시계'))).toBe(true)
})

test('a GPS reconnect clears an old bearing until new movement establishes direction', () => {
  const game = playing()
  game.headingDeg = 270
  game.headingAnchor = { lat: 37, lon: 127, t: 0, accuracy: 5 }
  game.lastFix = null
  updatePosition(game, { lat: 37.001, lon: 127, t: 20000, accuracy: 5 }, 20000)
  expect(game.headingDeg).toBeNull()
  expect(game.distance).toBe(0)
})

test('school-linked pause is unavailable for regular play and follows the school app rules once linked', () => {
  const game = playing()
  expect(startPause(game, 0)).toBe(false) // not a school-linked runner
  game.schoolLinked = true
  expect(pauseStatus(game, 0)).toMatchObject({ active: false, remainingBudgetSec: SCHOOL_PAUSE_BUDGET_SEC, segmentKm: 1 })
  expect(startPause(game, 0)).toBe(true)
  expect(startPause(game, 1000)).toBe(false) // already paused
  expect(pauseStatus(game, 30000)).toMatchObject({ active: true, remainingBudgetSec: SCHOOL_PAUSE_BUDGET_SEC - 30 })
  expect(endPause(game, 30000)).toBe(true)
  expect(game.pausedAt).toBe(0)
  expect(game.pauseBudgetSec).toBe(SCHOOL_PAUSE_BUDGET_SEC - 30)
  expect(endPause(game, 40000)).toBe(false) // nothing to end
})

test('school-linked pause budget refills on a full km and never carries a remainder over', () => {
  const game = playing()
  game.schoolLinked = true
  game.distance = 950
  game.pauseBudgetSec = 10 // partially spent in this segment
  updatePosition(game, { lat: 37, lon: 127, t: 1000, accuracy: 5 }, 1000) // still inside the same km
  expect(game.pauseBudgetSec).toBe(10)
  expect(pauseStatus(game, 1000).segmentKm).toBe(1)
  game.distance = 1005 // crosses the 1km mark
  updatePosition(game, { lat: 37, lon: 127, t: 2000, accuracy: 5 }, 2000)
  expect(game.pauseBudgetSec).toBe(SCHOOL_PAUSE_BUDGET_SEC) // refilled, not the old remainder
  expect(pauseStatus(game, 2000).segmentKm).toBe(2)
})

test('a paused school-linked runner does not accumulate distance until resumed', () => {
  const game = playing()
  game.schoolLinked = true
  game.movementAnchor = { lat: 37, lon: 127, t: 0, accuracy: 5 }
  game.lastFix = { lat: 37, lon: 127, t: 0, accuracy: 5 }
  startPause(game, 1000)
  updatePosition(game, { lat: 37.00045, lon: 127, t: 6000, accuracy: 5 }, 6000) // ~50m of real movement, but paused
  expect(game.distance).toBe(0)
  endPause(game, 6000)
  updatePosition(game, { lat: 37.0009, lon: 127, t: 12000, accuracy: 5 }, 12000) // another ~50m, now resumed
  expect(game.distance).toBeGreaterThan(0)
})

test('the pause auto-resumes once its budget or the 60s cap runs out, whichever comes first', () => {
  const capped = playing()
  capped.schoolLinked = true
  startPause(capped, 0)
  expect(checkPauseAutoResume(capped, SCHOOL_PAUSE_AUTO_RESUME_MS - 1000)).toBe(false)
  expect(checkPauseAutoResume(capped, SCHOOL_PAUSE_AUTO_RESUME_MS)).toBe(true)
  expect(capped.pausedAt).toBe(0)

  const drained = playing()
  drained.schoolLinked = true
  drained.pauseBudgetSec = 20
  startPause(drained, 0)
  expect(checkPauseAutoResume(drained, 19000)).toBe(false)
  expect(checkPauseAutoResume(drained, 20000)).toBe(true)
  expect(drained.pauseBudgetSec).toBe(0)
})

test('reaching the distance goal ends the run when not set to continue', () => {
  const game = playing()
  game.missionGoalM = 1000
  game.distance = 999
  let result = advanceGame(game, 1, 1000)
  expect(result.endReason).toBeNull()
  expect(game.goalReachedSec).toBeNull()
  game.distance = 1000
  result = advanceGame(game, 1, 2000)
  expect(result.endReason).toBe('goal_reached')
  expect(game.goalReachedSec).toBe(game.elapsedSec)
  expect(result.messages.some(m => m.includes('목표 거리'))).toBe(true)
})

test('reaching the distance goal while set to continue keeps the run going and only records the time once', () => {
  const game = playing()
  game.missionGoalM = 1000
  game.missionContinue = true
  game.distance = 1000
  let result = advanceGame(game, 1, 1000)
  expect(result.endReason).toBeNull()
  const firstReachedAt = game.goalReachedSec
  expect(firstReachedAt).toBe(game.elapsedSec)
  game.distance = 1500
  result = advanceGame(game, 1, 2000)
  expect(result.endReason).toBeNull()
  expect(game.goalReachedSec).toBe(firstReachedAt) // doesn't keep moving once already reached
})

test('reaching the time goal ends the run when not set to continue', () => {
  const game = playing()
  game.missionGoalSec = 600
  game.elapsedSec = 598
  game.distance = 1800
  let result = advanceGame(game, 1, 1000)
  expect(result.endReason).toBeNull()
  expect(game.goalReachedDistanceM).toBeNull()
  result = advanceGame(game, 1, 2000)
  expect(result.endReason).toBe('goal_reached')
  expect(game.goalReachedDistanceM).toBe(game.distance)
  expect(result.messages.some(m => m.includes('목표 시간'))).toBe(true)
})

test('reaching the time goal while set to continue keeps the run going and freezes the distance only once', () => {
  const game = playing()
  game.missionGoalSec = 600
  game.missionContinue = true
  game.elapsedSec = 600
  game.distance = 2000
  let result = advanceGame(game, 1, 1000)
  expect(result.endReason).toBeNull()
  expect(game.goalReachedDistanceM).toBe(2000)
  game.distance = 2500
  result = advanceGame(game, 1, 2000)
  expect(result.endReason).toBeNull()
  expect(game.goalReachedDistanceM).toBe(2000) // doesn't keep moving once already reached
})

test('computeLivePaceMps needs a minimum window and ignores a too-short one', () => {
  const game = playing()
  expect(computeLivePaceMps(game)).toBeNull() // no samples yet
  game.paceSamples = [{ t: 0, d: 0 }, { t: 3000, d: 10 }] // only 3s, under LIVE_PACE_MIN_WINDOW_SEC
  expect(computeLivePaceMps(game)).toBeNull()
  game.paceSamples = [{ t: 0, d: 0 }, { t: 10000, d: 25 }]
  expect(computeLivePaceMps(game)).toBe(2.5)
})

function paceRun(kind, goal, metersIn10s) {
  const game = playing()
  game.targetPaceMps = 2 // 500초/km
  game.missionPaceKind = kind
  game.missionPaceGoal = goal
  game.paceSamples = [{ t: 0, d: 0 }, { t: 20000, d: metersIn10s * 2 }]
  return game
}

test('pace diff is measured against the target pace and standing still is capped', () => {
  expect(paceDiffSec(paceRun(PACE_KIND.endless, 0, 20))).toBeCloseTo(0)
  expect(paceDiffSec(paceRun(PACE_KIND.endless, 0, 10))).toBeCloseTo(500) // 1m/s = 1000초/km
  expect(paceDiffSec(paceRun(PACE_KIND.endless, 0, 0))).toBe(600)
  expect(paceDiffSec({ ...paceRun(PACE_KIND.endless, 0, 20), paceSamples: [] })).toBeNull()
  expect(paceZone(15)).toBe('ok')
  expect(paceZone(-15)).toBe('ok')
  expect(paceZone(-20)).toBe('warn')
  expect(paceZone(30)).toBe('warn')
  expect(paceZone(31)).toBe('danger')
})

test('holding pace raises score and energy, and the pace run spawns no zombies', () => {
  const game = paceRun(PACE_KIND.endless, 0, 20)
  game.elapsedSec = 200 // past the first-wave time
  advanceGame(game, 1, 1000)
  expect(game.paceZone).toBe('ok')
  expect(game.paceScore).toBe(PACE_SCORE_MAX_PER_SEC)
  expect(game.paceEnergy).toBe(PACE_ENERGY_START + 2)
  expect(game.zombies).toHaveLength(0)
  expect(game.pickups).toHaveLength(0)
  expect(summonFirstWave(game, 1000)).toBe(false)
  game.paceEnergy = PACE_ENERGY_MAX
  advanceGame(game, 1, 2000)
  expect(game.paceEnergy).toBe(PACE_ENERGY_MAX) // capped
})

test('slightly off pace costs score but not energy; far off drains energy to game over', () => {
  const game = paceRun(PACE_KIND.endless, 0, 1000 / 520 * 10) // 520초/km, 20초 느림
  game.paceScore = 10
  advanceGame(game, 1, 1000)
  expect(game.paceZone).toBe('warn')
  expect(game.paceScore).toBe(8)
  expect(game.paceEnergy).toBe(PACE_ENERGY_START)
  game.paceSamples = [{ t: 0, d: 0 }, { t: 20000, d: 60 }] // much too fast
  const r1 = advanceGame(game, 1, 2000)
  expect(game.paceZone).toBe('danger')
  expect(game.paceScore).toBe(3)
  expect(game.paceEnergy).toBe(PACE_ENERGY_START - 3)
  expect(r1.messages.some(m => m.includes('너무 빨라요'))).toBe(true)
  advanceGame(game, 1, 3000)
  expect(game.paceScore).toBe(0) // never negative
  game.paceEnergy = 2
  const r2 = advanceGame(game, 1, 4000)
  expect(r2.endReason).toBe('energy_out')
  expect(game.paceCleared).toBe(false)
})

test('nothing changes while the pace is still being measured', () => {
  const game = paceRun(PACE_KIND.endless, 0, 20)
  game.paceSamples = []
  const r = advanceGame(game, 1, 1000)
  expect(r.endReason).toBeNull()
  expect(game.paceZone).toBeNull()
  expect(game.paceScore).toBe(0)
  expect(game.paceEnergy).toBe(PACE_ENERGY_START)
})

test('time and distance pace runs clear when the goal is reached with energy left', () => {
  const timed = paceRun(PACE_KIND.time, 10, 20)
  timed.elapsedSec = 9
  expect(advanceGame(timed, 1, 1000).endReason).toBe('goal_reached')
  expect(timed.paceCleared).toBe(true)
  const dist = paceRun(PACE_KIND.distance, 1000, 20)
  dist.distance = 999
  expect(advanceGame(dist, 1, 1000).endReason).toBeNull()
  dist.distance = 1000
  expect(advanceGame(dist, 1, 2000).endReason).toBe('goal_reached')
  expect(dist.paceCleared).toBe(true)
  const endless = paceRun(PACE_KIND.endless, 0, 20)
  endless.elapsedSec = 100000
  expect(advanceGame(endless, 1, 1000).endReason).toBeNull()
})

test('a saved map in pace mode starts with no patrol zombies', () => {
  const g = playing()
  g.missionPaceKind = PACE_KIND.endless
  applyStartSetup(g, g.playerPos, { paceMps: 2, forcedMap: { id: 'm', center: g.playerPos, radius: 1000, routes: [[{ lat: 37, lon: 127 }, { lat: 37.01, lon: 127 }]] } })
  expect(g.zombies).toHaveLength(0)
})

test('pace judging waits for a 15s window and the danger streak only counts consecutive seconds', () => {
  const game = paceRun(PACE_KIND.endless, 0, 10) // 1m/s — far too slow
  game.paceSamples = [{ t: 0, d: 0 }, { t: 10000, d: 10 }] // only 10s of samples
  advanceGame(game, 1, 1000)
  expect(game.paceZone).toBeNull()
  expect(game.paceEnergy).toBe(PACE_ENERGY_START)
  game.paceSamples = [{ t: 0, d: 0 }, { t: 20000, d: 20 }]
  advanceGame(game, 1, 2000)
  advanceGame(game, 1, 3000)
  expect(game.paceDangerSec).toBe(2)
  game.paceSamples = [{ t: 0, d: 0 }, { t: 20000, d: 40 }] // back on pace
  advanceGame(game, 1, 4000)
  expect(game.paceDangerSec).toBe(0)
})
