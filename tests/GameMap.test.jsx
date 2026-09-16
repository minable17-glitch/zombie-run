import React from 'react'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

const layers = vi.hoisted(() => ({ maps: [], markers: [], polylines: [] }))

vi.mock('leaflet', () => {
  const coordinates = (value) => {
    if (Array.isArray(value)) return value.map(coordinates)
    if (value && Number.isFinite(value.lat)) return [value.lat, value.lng ?? value.lon]
    return value
  }

  function makeLayer(kind, points, options = {}) {
    const layer = {
      kind,
      options,
      points: coordinates(points),
      element: null,
      addTo: vi.fn(function (map) {
        this.map = map
        if (kind === 'marker') {
          this.element = document.createElement('div')
          this.element.innerHTML = this.options.icon.html
          map.container.append(this.element)
        }
        return this
      }),
      setLatLng: vi.fn(function (point) {
        this.points = coordinates(point)
        return this
      }),
      setLatLngs: vi.fn(function (points) {
        this.points = coordinates(points)
        return this
      }),
      setIcon: vi.fn(function (icon) {
        this.options.icon = icon
        this.element.innerHTML = icon.html
        return this
      }),
      setRadius: vi.fn(),
      getElement: vi.fn(function () { return this.element }),
    }
    if (kind === 'marker') layers.markers.push(layer)
    if (kind === 'polyline') layers.polylines.push(layer)
    return layer
  }

  return { default: {
    map: vi.fn((container) => {
      const map = {
        container,
        setView: vi.fn(function () { return this }),
        panTo: vi.fn(),
        removeLayer: vi.fn((layer) => layer.element?.remove()),
        remove: vi.fn(() => container.replaceChildren()),
      }
      layers.maps.push(map)
      return map
    }),
    tileLayer: vi.fn((url, options) => makeLayer('tile', null, options)),
    divIcon: vi.fn((options) => options),
    marker: vi.fn((point, options) => makeLayer('marker', point, options)),
    polyline: vi.fn((points, options) => makeLayer('polyline', points, options)),
    circle: vi.fn((point, options) => makeLayer('circle', point, options)),
    polygon: vi.fn((points, options) => makeLayer('polygon', points, options)),
    latLng: vi.fn((lat, lng) => ({
      lat,
      lng,
      distanceTo(other) {
        const north = (other.lat - lat) * 111195
        const east = (other.lng - lng) * 111195 * Math.cos(lat * Math.PI / 180)
        return Math.hypot(north, east)
      },
    })),
  } }
})

import L from 'leaflet'
import GameMap from '../src/GameMap.jsx'

const empty = []
const start = { lat: 37, lon: 127 }
// Vitest stubs CSS imports, so read the real styles to exercise the marker size contract.
const baseCss = readFileSync('src/index.css', 'utf8')
const tacticalCss = readFileSync('src/tactical-ui.css', 'utf8')
let stylesheet

function view(props = {}) {
  return <div className="zr-game-shell"><GameMap
    playerPos={start}
    zombies={empty}
    pickups={empty}
    follow={false}
    areaCenter={null}
    areaRadius={null}
    headingDeg={0}
    trailDistance={0}
    trackingPaused={false}
    patrolRoutes={empty}
    {...props}
  /></div>
}

function trail() {
  return layers.polylines.find((layer) => layer.options.color === '#45ddff')
}

beforeEach(() => {
  vi.clearAllMocks()
  layers.maps.length = 0
  layers.markers.length = 0
  layers.polylines.length = 0
  stylesheet = document.createElement('style')
  stylesheet.textContent = `${baseCss}\n${tacticalCss}`
  document.head.append(stylesheet)
})

afterEach(() => {
  cleanup()
  stylesheet.remove()
})

test('Leaflet marker geometry matches the 42/38/34px CSS contract, including a zombie state change', () => {
  expect(tacticalCss).toContain('.zr-game-shell .zr-marker-player')
  const route = [start, { lat: 37.001, lon: 127 }]
  const zombie = { id: 'zombie', lat: 37.002, lon: 127, patrolRoute: route, state: 'patrol' }
  const pickups = [{ id: 'hourglass', type: 'hourglass', lat: 37.003, lon: 127 }]
  const patrolRoutes = [route]
  const { container, rerender } = render(view({ zombies: [zombie], pickups, patrolRoutes }))

  for (const [kind, size] of [['player', 42], ['zombie', 38], ['pickup', 34]]) {
    const icon = L.divIcon.mock.results.find(({ value }) => value.html.includes(`zr-marker-${kind}`)).value
    expect(icon.iconSize).toEqual([size, size])
    expect(icon.iconAnchor).toEqual([size / 2, size / 2])
    const marker = container.querySelector(`.zr-marker-${kind}`)
    expect(getComputedStyle(marker).width).toBe(`${size}px`)
    expect(getComputedStyle(marker).height).toBe(`${size}px`)
    expect(getComputedStyle(marker).boxSizing).toBe('border-box')
  }

  rerender(view({ zombies: [{ ...zombie, state: 'chase' }], pickups, patrolRoutes }))
  const updatedIcon = layers.markers[1].setIcon.mock.calls[0][0]
  expect(updatedIcon.iconSize).toEqual([38, 38])
  expect(updatedIcon.iconAnchor).toEqual([19, 19])
  expect(getComputedStyle(container.querySelector('.zr-marker-zombie')).width).toBe('38px')
})

test('a GPS coordinate jump cannot extend the trail without accepted distance', () => {
  const moved = { lat: 37.0001, lon: 127 }
  const jump = { lat: 38, lon: 128 }
  const { rerender } = render(view())
  rerender(view({ playerPos: moved, trailDistance: 10 }))
  const acceptedTrail = trail()
  expect(acceptedTrail).toBeTruthy()
  const beforeJump = structuredClone(acceptedTrail.points)
  const updates = acceptedTrail.setLatLngs.mock.calls.length

  rerender(view({ playerPos: jump, trailDistance: 10 }))

  expect(acceptedTrail.points).toEqual(beforeJump)
  expect(acceptedTrail.setLatLngs).toHaveBeenCalledTimes(updates)
  expect(JSON.stringify(acceptedTrail.points)).not.toContain('[38,128]')
  expect(layers.markers[0].setLatLng).toHaveBeenLastCalledWith([38, 128])
})

test('resuming tracking starts a separate polyline segment instead of connecting the GPS gap', () => {
  const moved = { lat: 37.0001, lon: 127 }
  const resumed = { lat: 37.01, lon: 127 }
  const movedAfterResume = { lat: 37.0101, lon: 127 }
  const { rerender } = render(view())
  rerender(view({ playerPos: moved, trailDistance: 10 }))
  rerender(view({ playerPos: moved, trailDistance: 10, trackingPaused: true }))
  rerender(view({ playerPos: resumed, trailDistance: 20 }))
  rerender(view({ playerPos: movedAfterResume, trailDistance: 30 }))

  expect(trail().points).toEqual([
    [[37, 127], [37.0001, 127]],
    [[37.01, 127], [37.0101, 127]],
  ])
  expect(layers.polylines.filter((layer) => layer.options.color === '#45ddff')).toHaveLength(1)
})

test('stable patrolRoutes keep their layers while zombie positions change every tick', () => {
  const route = [start, { lat: 37.001, lon: 127 }]
  const patrolRoutes = [route]
  const zombie = { id: 'zombie', lat: 37.0002, lon: 127, patrolRoute: route, state: 'patrol' }
  const { rerender } = render(view({ playerPos: null, zombies: [zombie], patrolRoutes }))
  const routeLayer = layers.polylines.find((layer) => layer.options.color === '#ff5a57')
  expect(routeLayer.points).toEqual([[37, 127], [37.001, 127]])

  for (const lat of [37.0003, 37.0004, 37.0005]) {
    rerender(view({ playerPos: null, zombies: [{ ...zombie, lat }], patrolRoutes }))
  }

  expect(layers.polylines).toHaveLength(1)
  expect(routeLayer.addTo).toHaveBeenCalledTimes(1)
  expect(layers.maps[0].removeLayer).not.toHaveBeenCalledWith(routeLayer)
  expect(layers.markers[0].setLatLng).toHaveBeenCalledTimes(3)
})

test('unmounting the game removes the Leaflet map exactly once', () => {
  const { unmount } = render(view())
  const map = layers.maps[0]
  expect(map.remove).not.toHaveBeenCalled()

  unmount()

  expect(map.remove).toHaveBeenCalledTimes(1)
})
