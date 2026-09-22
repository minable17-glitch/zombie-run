import React from 'react'
import { test, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
vi.mock('../src/lib/runnerApi.js', () => ({currentRunner:vi.fn(),connectRunner:vi.fn(),disconnectRunner:vi.fn(),soloBoard:vi.fn()}))
import * as api from '../src/lib/runnerApi.js'
import PersonalRunner from '../src/PersonalRunner.jsx'
import PersonalBoard from '../src/PersonalBoard.jsx'
const runner = {id:'runner',nickname:'달리미'}
const config = {playMode:'free',paceIdx:1,radiusIdx:1}
beforeEach(() => {
  vi.resetAllMocks()
  api.currentRunner.mockResolvedValue(null)
  api.soloBoard.mockResolvedValue({me:null,players:[],recent:[],total:0})
})
afterEach(cleanup)

test('first registration reveals personal code and requires saving it before solo start', async () => {
  api.connectRunner.mockResolvedValue({runner,code:'AABBCCDDEEFF00112233'})
  const onStart=vi.fn().mockResolvedValue(true)
  render(<PersonalRunner config={config} onStart={onStart} onBack={()=>{}} />)
  fireEvent.click(await screen.findByText('처음이에요'))
  fireEvent.change(screen.getByLabelText('닉네임'),{target:{value:'달리미'}})
  fireEvent.click(screen.getByText('닉네임 등록 · 개인 코드 받기'))
  expect(await screen.findByText('AABB-CCDD-EEFF-0011-2233')).toBeTruthy()
  expect(api.connectRunner).toHaveBeenCalledWith('달리미',null)
  expect(screen.getByText('생존 러닝 출발').disabled).toBe(true)
  fireEvent.click(screen.getByLabelText('개인 코드를 저장했어요'))
  fireEvent.click(screen.getByText('생존 러닝 출발'))
  await waitFor(()=>expect(onStart).toHaveBeenCalledExactlyOnceWith(config,{soloRunner:runner}))
})

test('existing nickname and personal code restore records without creating a room', async () => {
  api.connectRunner.mockResolvedValue({runner,code:null})
  api.soloBoard.mockResolvedValue({me:{...runner,rank:72,elapsed_sec:300,distance_m:800},players:[],total:90,recent:[]})
  render(<PersonalRunner config={config} onStart={()=>{}} onBack={()=>{}} />)
  await screen.findByLabelText('닉네임')
  fireEvent.change(screen.getByLabelText('닉네임'),{target:{value:'달리미'}})
  fireEvent.change(screen.getByLabelText('개인 코드'),{target:{value:'my-personal-code'}})
  fireEvent.click(screen.getByText('내 기록으로 접속'))
  expect(await screen.findByText('72위 / 90명')).toBeTruthy()
  expect(api.connectRunner).toHaveBeenCalledWith('달리미','my-personal-code')
  expect(screen.queryByText('나의 개인 코드')).toBeNull()
})

test('personal best improvement and server-ranked ties are shown without reranking top 50', () => {
  render(<PersonalBoard config={config} board={{me:{...runner,rank:2,elapsed_sec:90,distance_m:120},total:3,recent:[],players:[{...runner,rank:2,elapsed_sec:90,distance_m:120}]}}
    result={{is_best:true,previous_sec:60,elapsed_sec:90}} />)
  expect(screen.getByText('개인 최고 기록 갱신!')).toBeTruthy()
  expect(screen.getByText('이전 최고보다 0:30 더 생존했어요.')).toBeTruthy()
  expect(screen.getByText('2위 / 3명')).toBeTruthy()
})
