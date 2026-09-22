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
vi.mock('../src/PersonalRunner.jsx', () => ({ default: ({config,onStart}) => <button onClick={() => onStart(config,{soloRunner:{id:'solo',nickname:'나'}})}>개인 출발 테스트</button> }))
vi.mock('../src/lib/runnerApi.js', () => ({startSolo:vi.fn(async()=>({id:'run'})),updateSolo:vi.fn(async()=>({is_best:true,previous_sec:2,elapsed_sec:6})),soloBoard:vi.fn(async()=>({me:{id:'solo',nickname:'나',rank:1,elapsed_sec:6,distance_m:10},players:[],total:1,recent:[]}))}))
vi.mock('../src/GameMap.jsx', () => ({ default: ({ patrolRoutes }) => <div data-testid="map" data-routes={patrolRoutes?.length ?? 0} /> }))
import { updateRoomStat } from '../src/lib/roomApi.js'
import { startSolo, updateSolo } from '../src/lib/runnerApi.js'
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

test('survival start uses personal identity, saves solo record and displays improvement without a room', async () => {
  start = null
  await act(async()=>{render(<App />)})
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'생존 러닝 시작'}))})
  expect(start).toBeNull()
  await act(async()=>{fireEvent.click(screen.getByText('개인 출발 테스트'))})
  await act(async()=>{await start(fix())})
  expect(startSolo).toHaveBeenCalledWith(expect.any(String),{paceIdx:1,playMode:'free',radiusIdx:1})
  await act(async()=>{vi.advanceTimersByTime(6000);watch(fix())})
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'러닝 종료'}))})
  expect(updateRoomStat).not.toHaveBeenCalled()
  expect(updateSolo).toHaveBeenLastCalledWith(expect.any(String),expect.objectContaining({elapsed:6,status:'finished'}))
  expect(screen.getByText('내 기록 저장 완료')).toBeTruthy()
  expect(screen.getByText('개인 최고 기록 갱신!')).toBeTruthy()
  expect(screen.getByText('이전 최고보다 0:04 더 생존했어요.')).toBeTruthy()
})
