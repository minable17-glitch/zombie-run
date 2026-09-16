import { expect, test } from 'vitest'
import { polygonError, insidePolygon, insideArea, segmentInside, polygonBounds } from '../src/lib/playArea.js'

const polygon = [[0,0],[4,0],[4,4],[3,4],[3,1],[1,1],[1,4],[0,4]].map(([x,y]) => ({ lat: 37+y/1000, lon: 127+x/1000 }))
const point = (x,y) => ({ lat:37+y/1000, lon:127+x/1000 })
test('concave boundaries exclude the notch, include edges, and reject crossing routes', () => {
  expect(polygonError(polygon)).toBe('')
  expect(insidePolygon(point(.5,3), polygon)).toBe(true)
  expect(insidePolygon(point(2,3), polygon)).toBe(false)
  expect(insidePolygon(point(1,3), polygon)).toBe(true)
  expect(segmentInside(point(.5,3), point(3.5,3), polygon)).toBe(false)
  expect(segmentInside(point(.5,.5), point(3.5,.5), polygon)).toBe(true)
  const bounds=polygonBounds(polygon)
  expect(insideArea(point(2,3), bounds.center, bounds.radius, polygon)).toBe(false)
  expect(insideArea(point(2,3), bounds.center, bounds.radius, null)).toBe(true)
})
test('invalid boundaries fail before rendering or saving', () => {
  expect(polygonError(polygon.slice(0,2))).not.toBe('')
  expect(polygonError([point(0,0),point(4,4),point(0,4),point(4,0)])).toContain('교차')
  expect(polygonError([point(0,0),point(1,0),point(2,0)])).not.toBe('')
  expect(polygonError([point(0,0),point(1,0),{lat:NaN,lon:127}])).not.toBe('')
})
