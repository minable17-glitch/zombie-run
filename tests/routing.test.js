import { afterEach, expect, test, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

async function route(coordinates) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true, json: async () => ({ features: [{ geometry: { coordinates } }] }),
  }))
  const { fetchWalkingPath } = await import('../src/lib/routing.js')
  return fetchWalkingPath('test-key', { lat: 37, lon: 127 }, { lat: 37.001, lon: 127 })
}

test.each([
  [[127, 37], null],
  [[127, 37], [127, 91]],
  [[127, 37], ['127', 37]],
  [[127, 37], [Infinity, 37]],
])('invalid route coordinates fall back to straight movement: %j', async (a, b) => {
  expect(await route([a, b])).toBeNull()
})

test('valid route coordinates preserve longitude and latitude order', async () => {
  expect(await route([[127, 37], [127.001, 37.002]])).toEqual([
    { lat: 37, lon: 127 }, { lat: 37.002, lon: 127.001 },
  ])
})
