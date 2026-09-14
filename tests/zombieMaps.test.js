import { describe, expect, test } from 'vitest'
import { mapNameError, normalizeMapName, selectableZombieMap } from '../src/lib/zombieMaps.js'

const validRow = {
  id: 'map-1', name: '우리 공원', center_lat: 37, center_lon: 127,
  radius_m: 400, routes: [[{ lat: 37, lon: 127 }, { lat: 37.001, lon: 127.001 }]],
}

describe('zombie map names', () => {
  test('normalizes whitespace and rejects blank, placeholder, and duplicate names', () => {
    expect(normalizeMapName('  우리   공원  ')).toBe('우리 공원')
    expect(mapNameError('   ')).toContain('입력')
    expect(mapNameError('이름 없는 지도')).toContain('구분')
    expect(mapNameError('우리 공원', [{ id: 'other', name: '우리 공원' }])).toContain('이미')
    expect(mapNameError('우리 공원', [{ id: 'map-1', name: '우리 공원' }], 'map-1')).toBe('')
  })

  test('game selection hides legacy placeholder and empty maps', () => {
    expect(selectableZombieMap(validRow)).toBe(true)
    expect(selectableZombieMap({ ...validRow, name: '이름 없는 지도' })).toBe(false)
    expect(selectableZombieMap({ ...validRow, routes: [] })).toBe(false)
  })
})
