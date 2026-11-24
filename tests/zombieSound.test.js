import { test, expect, vi } from 'vitest'
import { createCalloutTracker, growlPlan, calloutText, nearText, createZombieAudio, SOUND_PACKS } from '../src/lib/zombieSound.js'
import { existsSync } from 'node:fs'

test('distance callouts fire once per step on the way in, and again after backing off', () => {
  const next = createCalloutTracker()
  expect(next(65)).toBe(null)
  expect(next(49)).toBe(50)
  expect(next(47)).toBe(null)
  expect(next(28)).toBe(30) // jumped past 40 → only the nearest step is read
  expect(next(29)).toBe(null)
  expect(next(38)).toBe(null) // backed off past 36 → 30 is armed again
  expect(next(29)).toBe(30)
  expect(next(9)).toBe(10)
})

test('growls get louder and more frequent as the zombie closes in', () => {
  expect(growlPlan(80)).toBe(null)
  const far = growlPlan(60), near = growlPlan(10)
  expect(near.volume).toBeGreaterThan(far.volume)
  expect(near.intervalMs).toBeLessThan(far.intervalMs)
  expect(calloutText(30)).toBe('좀비 30미터')
  expect(calloutText(10)).toBe('10미터! 빨리!')
})

test('the audio speaks Korean callouts and survives without Web Audio', () => {
  const speak = vi.fn()
  class Utterance { constructor(text) { this.text = text } }
  const audio = createZombieAudio({ AudioContextImpl: undefined, speech: { speak, cancel: vi.fn() }, Utterance, fetchImpl: undefined })
  audio.unlock()
  expect(audio.update(45, 1000)).toBe(50)
  expect(speak.mock.calls.at(-1)[0]).toMatchObject({ text: '좀비 50미터', lang: 'ko-KR' })
  expect(audio.update(39, 1500)).toBe(null) // too soon after the last callout
  expect(audio.update(8, 1600)).toBe(10) // the 10m warning always gets through
  expect(audio.update(30, 5000, false)).toBe(null)
})

test('while a zombie hangs around within 30m the distance is read again every 5 seconds', () => {
  const speak = vi.fn()
  class Utterance { constructor(text) { this.text = text } }
  const audio = createZombieAudio({ AudioContextImpl: undefined, speech: { speak, cancel: vi.fn(), getVoices: () => [{ lang: 'ko-KR', name: 'ko' }] }, Utterance, fetchImpl: undefined })
  expect(audio.update(24, 0)).toBe(30)
  expect(audio.update(23, 3000)).toBe(null)
  expect(audio.update(22, 5100)).toBe(22)
  expect(speak.mock.calls.at(-1)[0]).toMatchObject({ text: '좀비 20미터', voice: { lang: 'ko-KR' } })
  expect(nearText(11)).toBe('바로 뒤! 빨리!')
  expect(audio.update(40, 20000)).toBe(null) // far again: quiet
})

test('every sound pack file exists in public/sfx', () => {
  for (const [key, pack] of Object.entries(SOUND_PACKS))
    for (const f of [...pack.growls, pack.attack]) expect(existsSync(`public/sfx/${key}/${f}`), `${key}/${f}`).toBe(true)
})
