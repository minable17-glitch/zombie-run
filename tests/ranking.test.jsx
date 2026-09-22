import React from 'react'
import { test, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { rankPlayers } from '../src/lib/leaderboard.js'
import { createProximityAlert } from '../src/lib/proximityAlert.js'
import { createRoomReporter } from '../src/lib/roomReporter.js'
import Leaderboard from '../src/Leaderboard.jsx'
afterEach(cleanup)

test('survival beats distance; exact ties share rank and identities remain distinct', () => {
  const players = [
    { id: 'a', nickname: '같은이름', elapsed_sec: 120, distance_m: 99 },
    { id: 'b', nickname: '같은이름', elapsed_sec: 121, distance_m: 1 },
    { id: 'c', elapsed_sec: 120, distance_m: 99 },
    { id: 'd', elapsed_sec: 120, distance_m: 98 },
  ]
  expect(rankPlayers(players).map(p => [p.id, p.rank])).toEqual([['b',1],['a',2],['c',2],['d',4]])
  expect(players[0].id).toBe('a')
  render(<Leaderboard players={players} playerId="a" />)
  expect(screen.getByText('내 순위 2위 / 4명')).toBeTruthy()
  expect(screen.getByText('같은이름 (나)')).toBeTruthy()
})

test('proximity pulses escalate immediately, are throttled, and stop on pause or disable', () => {
  const vibrate = vi.fn()
  const alert = createProximityAlert(vibrate)
  alert.update(100, 0)
  expect(vibrate).not.toHaveBeenCalled()
  alert.update(60, 1000)
  alert.update(55, 2000)
  expect(vibrate).toHaveBeenCalledTimes(1)
  alert.update(20, 2500)
  expect(vibrate).toHaveBeenLastCalledWith([200,100,200])
  alert.update(20, 3000)
  expect(vibrate).toHaveBeenCalledTimes(2)
  alert.update(20, 5500)
  expect(vibrate).toHaveBeenCalledTimes(3)
  alert.update(20, 6000, false)
  expect(vibrate).toHaveBeenLastCalledWith(0)
  alert.update(Infinity, 7000)
  expect(vibrate).toHaveBeenCalledTimes(4)
  expect(() => createProximityAlert(() => { throw Error('blocked') }).update(1, 1)).not.toThrow()
  expect(() => createProximityAlert().update(1, 1)).not.toThrow()
})

test.each([[65,8000,[100]],[45,4000,[140,160,140]],[25,2000,[200,100,200]],[14,1000,[250,80,250,80,250]]])('distance %s uses its urgency cadence and cancels outside range', (distance,interval,pattern) => {
  const vibrate=vi.fn(), alert=createProximityAlert(vibrate)
  alert.update(distance,0)
  expect(vibrate).toHaveBeenLastCalledWith(pattern)
  alert.update(distance,interval-1)
  expect(vibrate).toHaveBeenCalledTimes(1)
  alert.update(distance,interval)
  expect(vibrate).toHaveBeenCalledTimes(2)
  alert.update(71,interval+1)
  expect(vibrate).toHaveBeenLastCalledWith(0)
})

test('finish waits for an in-flight alive update and retries failed terminal saves', async () => {
  let release
  const send = vi.fn().mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    .mockRejectedValueOnce(Error('offline')).mockResolvedValue(undefined)
  const success = vi.fn(), error = vi.fn()
  const reporter = createRoomReporter(send, success, error)
  reporter.submit({status:'alive',elapsed:5})
  reporter.submit({status:'finished',elapsed:8})
  reporter.submit({status:'alive',elapsed:9})
  expect(send).toHaveBeenCalledTimes(1)
  release()
  await vi.waitFor(() => expect(error).toHaveBeenCalledTimes(1))
  await reporter.retry()
  expect(send.mock.calls.map(c => c[0])).toEqual([{status:'alive',elapsed:5},{status:'finished',elapsed:8},{status:'finished',elapsed:8}])
  expect(success).toHaveBeenLastCalledWith({status:'finished',elapsed:8})
  reporter.dispose()
  reporter.submit({status:'alive',elapsed:10})
  expect(send).toHaveBeenCalledTimes(3)
})
