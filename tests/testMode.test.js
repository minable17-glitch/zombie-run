import { describe, expect, test } from 'vitest'
import { isLocalTestMode, makeTestPosition, TEST_CENTER } from '../src/lib/testMode.js'

describe('local test mode', () => {
  test('only enables on localhost with test=1', () => {
    expect(isLocalTestMode({ hostname: 'localhost', search: '?test=1' })).toBe(true)
    expect(isLocalTestMode({ hostname: '127.0.0.1', search: '?test=1' })).toBe(true)
    expect(isLocalTestMode({ hostname: 'minable17-glitch.github.io', search: '?test=1' })).toBe(false)
    expect(isLocalTestMode({ hostname: 'localhost', search: '' })).toBe(false)
  })

  test('creates a safe moving test position', () => {
    const position = makeTestPosition(123, 2)
    expect(position.timestamp).toBe(123)
    expect(position.coords.accuracy).toBe(5)
    expect(position.coords.latitude).not.toBe(TEST_CENTER.lat)
    const custom = makeTestPosition(123, 0, { lat: 35, lon: 129 })
    expect(custom.coords.latitude).toBe(35)
    expect(custom.coords.longitude).toBe(129)
  })
})
