import React from 'react'
import { beforeEach, afterEach, test, expect, vi } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
vi.mock('../src/lib/supabaseClient.js', () => ({ supabase: null }))
vi.mock('../src/lib/zombieMaps.js', () => ({ fetchZombieMaps: async () => [] }))
vi.mock('../src/GameMap.jsx', () => ({ default: ({ zombies }) => <div data-testid="game-map">{zombies.length}</div> }))
vi.mock('../src/AdminRouteEditor.jsx', () => ({ default: () => null }))
import App from '../src/App.jsx'
import { createStepDetector, createShakeRunner, isTrialEntry, TRIAL_GAME } from '../src/lib/trial.js'
import { haversineDistance } from '../src/lib/geo.js'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-27T12:00:00Z'))
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  window.history.replaceState({}, '', '/')
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: vi.fn(), watchPosition: vi.fn(), clearWatch: vi.fn() } })
})
afterEach(() => { cleanup(); vi.useRealTimers() })

test('a shake counts once per peak, ignores jitter and too-close peaks', () => {
  const feed = createStepDetector()
  expect(feed(1, 0)).toBe(false) // calm
  expect(feed(6, 100)).toBe(true) // peak → step
  expect(feed(7, 150)).toBe(false) // still high, not re-armed
  expect(feed(1, 200)).toBe(false) // re-arm
  expect(feed(6, 250)).toBe(false) // re-armed but only 150ms after last step
  expect(feed(1, 300)).toBe(false)
  expect(feed(6, 400)).toBe(true)
  expect(feed(NaN, 500)).toBe(false)
})

test('the shake runner moves a virtual position forward by stride per step', () => {
  const start = { lat: 37.5, lon: 127 }
  const runner = createShakeRunner(start, { stride: 1 })
  const at0 = runner.position(1000)
  expect(at0.coords).toMatchObject({ latitude: 37.5, longitude: 127, accuracy: 5 })
  for (let i = 0; i < 10; i++) runner.step()
  const p = runner.position(2000).coords
  expect(runner.steps).toBe(10)
  expect(haversineDistance(37.5, 127, p.latitude, p.longitude)).toBeCloseTo(10, 0)
  runner.stop()
})

test('?try opens the trial screen directly', () => {
  expect(isTrialEntry({ search: '?try=1' })).toBe(true)
  expect(isTrialEntry({ search: '?try' })).toBe(true)
  expect(isTrialEntry({ search: '?test=1' })).toBe(false)
})

test('indoor trial starts without GPS, summons zombies fast, and tapping moves the runner', async () => {
  await act(async () => { render(<App />) })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /로그인 없이 1분 체험/ })) })
  expect(screen.getByRole('heading', { name: '좀비런 1분 체험' })).toBeTruthy()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /체험 시작/ })) })
  expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled()
  expect(screen.getByRole('meter', { name: /생명/ }).getAttribute('aria-valuemax')).toBe(String(TRIAL_GAME.maxHealth))
  expect(screen.getByLabelText(/경과 시간/)).toBeTruthy()
  const tap = screen.getByRole('button', { name: /탭해서 달리기/ })
  for (let s = 0; s < 6; s++) {
    for (let i = 0; i < 3; i++) fireEvent.pointerDown(tap)
    await act(async () => { vi.advanceTimersByTime(1000) })
  }
  expect(screen.getByText(/18걸음/)).toBeTruthy()
  expect(Number(screen.getByTestId('game-map').textContent)).toBeGreaterThan(0) // first wave at ~3s
  expect(screen.getByLabelText(/달린 거리/).getAttribute('aria-label')).not.toBe('달린 거리 0m')
})

test('surviving the trial time ends in success and "처음으로" returns to the trial screen', async () => {
  window.history.replaceState({}, '', '/?try=1')
  await act(async () => { render(<App />) })
  fireEvent.click(screen.getByRole('button', { name: '30초' }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /체험 시작/ })) })
  const tap = screen.getByRole('button', { name: /탭해서 달리기/ })
  for (let s = 0; s < 32; s++) {
    for (let i = 0; i < 4; i++) fireEvent.pointerDown(tap) // 4m/s — outruns the 7'00" zombie
    await act(async () => { vi.advanceTimersByTime(1000) })
  }
  expect(screen.getByRole('heading', { name: '0:30 생존 성공!' })).toBeTruthy()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '처음으로' })) })
  expect(screen.getByRole('heading', { name: '좀비런 30초 체험' })).toBeTruthy()
})

test('indoor trial runs by tapping only, vibrates as zombies close in and hard when caught', async () => {
  const vibrate = vi.fn(() => true)
  Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate })
  window.history.replaceState({}, '', '/?try=1')
  await act(async () => { render(<App />) })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /체험 시작/ })) })
  // 흔들어도 움직이지 않는다
  for (let i = 0; i < 10; i++) {
    window.dispatchEvent(Object.assign(new Event('devicemotion'), { acceleration: { x: 8, y: 0, z: 0 } }))
    window.dispatchEvent(Object.assign(new Event('devicemotion'), { acceleration: { x: 0, y: 0, z: 0 } }))
  }
  expect(screen.getByText(/· 0걸음/)).toBeTruthy()
  for (let s = 0; s < 40 && !vibrate.mock.calls.some(c => String(c[0]) === '500,120,500'); s++) {
    await act(async () => { vi.advanceTimersByTime(1000) })
  }
  const patterns = vibrate.mock.calls.map(c => String(c[0]))
  expect(patterns.some(p => p !== '0' && p !== '500,120,500')).toBe(true) // 접근 진동
  expect(patterns).toContain('500,120,500') // 잡힘 진동
  delete navigator.vibrate
})
