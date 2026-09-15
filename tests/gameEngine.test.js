import { test, expect } from 'vitest'
import { advanceGame, applyStartSetup, makeInitialGame, updatePosition } from '../src/lib/gameEngine.js'

function playing() {
  return { ...makeInitialGame(), status: 'playing', playerPos: { lat: 37, lon: 127 } }
}

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
  applyStartSetup(game, { lat: 37, lon: 127 }, {
    paceMps: 2, playMode: 'free', radiusM: 400,
    zombieMaps: [{ id: 'map', name: '공원', center: { lat: 37, lon: 127 }, radius: 400, routes: [route] }],
    forcedMap: null,
  })
  const before = game.zombies[0]
  advanceGame(game, 1, 1000)
  expect(game.zombies[0].state).toBe('patrol')
  expect(game.zombies[0].lat).not.toBe(before.lat)
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
