import React from 'react'
import { beforeEach, afterEach, test, expect, vi } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
const rpc = vi.hoisted(() => vi.fn())
vi.mock('../src/lib/supabaseClient.js', () => ({ supabase: { rpc, auth: {
  getSession: async () => ({ data: { session: null } }),
  onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
} } }))
vi.mock('../src/lib/zombieMaps.js', () => ({ fetchZombieMaps: async () => [] }))
vi.mock('../src/GameMap.jsx', () => ({ default: ({ zombies }) => <div data-testid="game-map">{zombies.length}</div> }))
vi.mock('../src/AdminRouteEditor.jsx', () => ({ default: () => null }))
import App from '../src/App.jsx'
import { trialScore } from '../src/lib/trialApi.js'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-27T12:00:00Z'))
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  window.history.replaceState({}, '', '/?try=1')
  localStorage.clear()
  rpc.mockReset()
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: vi.fn(), watchPosition: vi.fn(), clearWatch: vi.fn() } })
})
afterEach(() => { cleanup(); vi.useRealTimers() })

// 팔 흔들기 흉내: 1초에 perSec 번, 회전 속도가 크게 튀었다가 가라앉는다
async function swingFor(seconds, perSec = 4) {
  const half = 1000 / perSec / 2
  for (let s = 0; s < seconds; s++) {
    await act(async () => {
      for (let i = 0; i < perSec; i++) {
        window.dispatchEvent(Object.assign(new Event('devicemotion'), { rotationRate: { alpha: 200, beta: 0, gamma: 0 } }))
        vi.advanceTimersByTime(half)
        window.dispatchEvent(Object.assign(new Event('devicemotion'), { rotationRate: { alpha: 5, beta: 0, gamma: 0 } }))
        vi.advanceTimersByTime(half)
      }
    })
  }
}

test('trial score: survived seconds, lives only when the time was survived, distance', () => {
  expect(trialScore({ survived: 60, lives: 2, distance: 150.7, seconds: 60 })).toBe(600 + 200 + 150)
  expect(trialScore({ survived: 41.9, lives: 1, distance: 90, seconds: 60 })).toBe(410 + 90)
})

test('a named trial is entered into today\'s ranking and the result shows the board', async () => {
  rpc.mockImplementation(async name => ({
    zr_trial_start: { data: 'run-1' },
    zr_trial_finish: { data: { name: '민수', score: 520, survived: 30, lives: 1, distance: 120, best: 520, rank: 2 } },
    zr_trial_board: { data: [
      { rank: 1, name: '지영', score: 630, survived: 30, lives: 2, distance: 130 },
      { rank: 2, name: '민수', score: 520, survived: 30, lives: 1, distance: 120 },
    ] },
  })[name])
  await act(async () => { render(<App />) })
  fireEvent.click(screen.getByRole('button', { name: /7'00"/ }))
  fireEvent.change(screen.getByLabelText(/이름/), { target: { value: ' 민수 ' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /체험 시작/ })) })
  expect(rpc).toHaveBeenCalledWith('zr_trial_start', { p_name: '민수', p_indoor: true, p_seconds: 30, p_pace: 3 })
  expect(localStorage.getItem('zr-trial-name')).toBe('민수')
  await swingFor(32)
  expect(screen.getByRole('heading', { name: '0:30 생존 성공!' })).toBeTruthy()
  const finish = rpc.mock.calls.find(c => c[0] === 'zr_trial_finish')[1]
  expect(finish).toMatchObject({ p_id: 'run-1', p_survived: 30 })
  expect(finish.p_lives).toBeGreaterThan(0)
  expect(finish.p_distance).toBeGreaterThan(80)
  expect(rpc).toHaveBeenCalledWith('zr_trial_board', { p_indoor: true, p_seconds: 30, p_limit: 20 })
  expect(screen.getByText('520점 · 오늘 2위')).toBeTruthy()
  expect(screen.getByText('민수 (나)')).toBeTruthy()
  expect(screen.getByText('지영')).toBeTruthy()
  // 다시 하면 이름이 채워져 있다
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '처음으로' })) })
  expect(screen.getByLabelText(/이름/).value).toBe('민수')
})

test('without a name the trial plays without touching the ranking server', async () => {
  await act(async () => { render(<App />) })
  expect(screen.getByText(/이름을 비우면 순위 없이/)).toBeTruthy()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /체험 시작/ })) })
  expect(screen.getByText(/팔을 흔들어요/)).toBeTruthy()
  expect(rpc).not.toHaveBeenCalled()
})

test('a ranking server failure still starts the trial', async () => {
  rpc.mockResolvedValue({ error: { message: 'down' } })
  await act(async () => { render(<App />) })
  fireEvent.change(screen.getByLabelText(/이름/), { target: { value: '민수' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /체험 시작/ })) })
  expect(screen.getByText(/팔을 흔들어요/)).toBeTruthy()
})

test('the start screen can show today\'s 30-second board', async () => {
  rpc.mockResolvedValue({ data: [{ rank: 1, name: '지영', score: 630, survived: 30, lives: 2, distance: 30 }] })
  await act(async () => { render(<App />) })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '오늘 순위 보기' })) })
  expect(rpc).toHaveBeenCalledWith('zr_trial_board', { p_indoor: true, p_seconds: 30, p_limit: 20 })
  expect(screen.getByText('지영')).toBeTruthy()
  expect(screen.getByText('오늘의 순위 · 실내 30초')).toBeTruthy()
})
