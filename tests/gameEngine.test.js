import { test, expect } from 'vitest'
import { advanceGame, applyStartSetup, makeInitialGame, updatePosition, summonFirstWave } from '../src/lib/gameEngine.js'
import { haversineDistance } from '../src/lib/geo.js'
import { insidePolygon } from '../src/lib/playArea.js'

function playing() {
  return { ...makeInitialGame(), status: 'playing', playerPos: { lat: 37, lon: 127 } }
}

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
