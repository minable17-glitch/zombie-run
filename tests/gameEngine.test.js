import { test, expect } from 'vitest'
import { advanceGame, makeInitialGame } from '../src/lib/gameEngine.js'

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
