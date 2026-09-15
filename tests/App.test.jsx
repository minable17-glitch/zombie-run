import React from 'react'
import { beforeEach, afterEach, test, expect, vi } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
const state=vi.hoisted(()=>({maps:[]}))
vi.mock('../src/lib/supabaseClient.js',()=>({supabase:null}))
vi.mock('../src/lib/zombieMaps.js',()=>({fetchZombieMaps:async()=>state.maps}))
vi.mock('../src/GameMap.jsx',()=>({default:({zombies})=><div role="region" aria-label="게임 지도" data-testid="game-map">{zombies.length}</div>}))
vi.mock('../src/AdminRouteEditor.jsx',()=>({default:()=>null}))
import App from '../src/App.jsx'
let callbacks, watch, clearWatch
const fix=()=>({timestamp:Date.now(),coords:{latitude:37,longitude:127,accuracy:5}})
beforeEach(()=>{
 vi.useFakeTimers()
 vi.setSystemTime(new Date('2026-09-09T12:00:00Z'))
 Object.defineProperty(document,'hidden',{configurable:true,value:false})
 window.history.replaceState({},'','/')
 state.maps=[]
 callbacks=[]
 watch=vi.fn(()=>123); clearWatch=vi.fn()
 Object.defineProperty(navigator,'geolocation',{configurable:true,value:{
  getCurrentPosition:vi.fn((success,error)=>callbacks.push({success,error})),
  watchPosition:watch,clearWatch,
 }})
})
afterEach(()=>{cleanup();vi.useRealTimers()})
async function renderApp(){await act(async()=>{render(<React.StrictMode><App /></React.StrictMode>)})}
test('double start only creates one GPS request and game loop; finishing stops GPS',async()=>{
 await renderApp()
 const button=screen.getByRole('button',{name:'생존 러닝 시작'})
 await act(async()=>{fireEvent.click(button);fireEvent.click(button)})
 expect(navigator.geolocation.getCurrentPosition).toHaveBeenCalledTimes(1)
 await act(async()=>callbacks[0].success(fix()))
 expect(screen.getByRole('region',{name:'게임 지도'})).toBeTruthy()
 expect(screen.getByLabelText(/경과 시간/)).toBeTruthy()
 expect(screen.getByLabelText(/달린 거리/)).toBeTruthy()
 expect(screen.getByLabelText(/가장 가까운 좀비/)).toBeTruthy()
 expect(screen.getByRole('meter',{name:/생명/}).getAttribute('aria-valuenow')).toBe('6')
 expect(watch).toHaveBeenCalledTimes(1)
 const followButton=screen.getByRole('button',{name:'내 위치 자동 추적'})
 expect(followButton.getAttribute('aria-pressed')).toBe('true')
 fireEvent.click(followButton)
 expect(followButton.getAttribute('aria-pressed')).toBe('false')
 act(()=>vi.advanceTimersByTime(1000))
 expect(screen.getByText('0:01')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'러닝 종료'}))
 expect(clearWatch).toHaveBeenCalledWith(123)
 expect(screen.getByText('생존 시간')).toBeTruthy()
})
test('GPS failure permits retry; stale signal pauses time and damage',async()=>{
 await renderApp()
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'생존 러닝 시작'})))
 await act(async()=>callbacks[0].error({}))
 expect(screen.getByRole('button',{name:'생존 러닝 시작'}).disabled).toBe(false)
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'생존 러닝 시작'})))
 await act(async()=>callbacks[1].success(fix()))
 act(()=>vi.advanceTimersByTime(16000))
 expect(screen.getByText('GPS 신호를 기다리는 동안 게임이 잠시 멈춰요.')).toBeTruthy()
 expect(screen.getByText('GPS PAUSED')).toBeTruthy()
 expect(screen.getByText('0:15')).toBeTruthy()
 act(()=>vi.advanceTimersByTime(5000))
 expect(screen.getByText('0:15')).toBeTruthy()
})
test('a selected-route zombie stays on its route while the game is running',async()=>{
 state.maps=[{id:'map',name:'Test',center:{lat:37,lon:127},radius:400,
 routes:[[{lat:37,lon:127},{lat:37.001,lon:127}]]}]
 await renderApp()
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'생존 러닝 시작'})))
 await act(async()=>callbacks[0].success(fix()))
 act(()=>vi.advanceTimersByTime(1000))
 expect(screen.getByRole('meter',{name:/생명/}).getAttribute('aria-valuenow')).toBe('5')
 act(()=>vi.advanceTimersByTime(4000))
 expect(screen.getByRole('meter',{name:/생명/}).getAttribute('aria-valuenow')).toBe('5')
 act(()=>vi.advanceTimersByTime(1000))
 expect(screen.getByRole('meter',{name:/생명/}).getAttribute('aria-valuenow')).toBe('5')
})

