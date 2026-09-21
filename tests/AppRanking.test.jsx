import React from 'react'
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
const state = vi.hoisted(() => ({ config: {}, maps: [], players: [] }))
vi.mock('../src/lib/supabaseClient.js', () => ({ supabase: { auth: {
  getSession: async () => ({ data: { session: null } }),
  onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
} } }))
vi.mock('../src/lib/zombieMaps.js', () => ({ fetchZombieMaps: async () => state.maps }))
vi.mock('../src/lib/roomApi.js', () => ({ readRoom: vi.fn(async () => ({ players: state.players })), updateRoomStat: vi.fn(async () => {}) }))
vi.mock('../src/RoomLobby.jsx', () => ({ default: ({ onStart }) => <button onClick={() => onStart(state.config, { roomId:'room', playerId:'me', nickname:'나' })}>참가 테스트</button> }))
vi.mock('../src/GameMap.jsx', () => ({ default: ({ patrolRoutes }) => <div data-testid="map" data-routes={patrolRoutes?.length ?? 0} /> }))
import { updateRoomStat } from '../src/lib/roomApi.js'
import App from '../src/App.jsx'
let start, watch
const fix = () => ({ timestamp:Date.now(), coords:{ latitude:37, longitude:127, accuracy:5 } })
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks()
  Object.defineProperty(document, 'hidden', { configurable:true, value:false })
  Object.defineProperty(navigator, 'geolocation', { configurable:true, value:{
    getCurrentPosition: cb => { start = cb }, watchPosition: cb => { watch = cb; return 1 }, clearWatch: vi.fn(),
  } })
  window.history.replaceState({}, '', '/')
  state.players = [{ id:'me', nickname:'나', elapsed_sec:5, distance_m:10, status:'alive' }, {id:'other', nickname:'친구',elapsed_sec:10,distance_m:1,status:'alive'}]
  state.maps = [{id:'map',name:'공원',center:{lat:37,lon:127},radius:400,routes:[[{lat:37.002,lon:127},{lat:37.003,lon:127}]]}]
})
afterEach(() => { cleanup(); vi.useRealTimers() })
test.each([false,true])('room ranking and final record work in free/map mode (map: %s)', async map => {
  state.config = map ? {mapId:'map',paceIdx:1} : {playMode:'free',paceIdx:1}
  await act(async () => { render(<App />) })
  await act(async () => { fireEvent.click(screen.getByRole('button',{name:/그룹 러닝/})) })
  await act(async () => { fireEvent.click(screen.getByText('참가 테스트')) })
  await act(async () => { start(fix()) })
  expect(screen.getByTestId('map').getAttribute('data-routes')).toBe(map ? '1' : '0')
  fireEvent.click(screen.getByRole('button',{name:'내 순위와 생존 랭킹'}))
  expect(screen.getByText('내 순위 2위 / 2명')).toBeTruthy()
  await act(async () => { vi.advanceTimersByTime(6000); watch(fix()) })
  expect(updateRoomStat).toHaveBeenCalledWith('room',expect.any(Number),expect.any(Number),'alive',expect.any(Number))
  await act(async () => { fireEvent.click(screen.getByRole('button',{name:'러닝 종료'})) })
  expect(updateRoomStat).toHaveBeenLastCalledWith('room',expect.any(Number),expect.any(Number),'finished',6)
  expect(screen.getByText('내 최종 기록 저장 완료')).toBeTruthy()
  expect(screen.getByText('내 순위 2위 / 2명')).toBeTruthy()
})
