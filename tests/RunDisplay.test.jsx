import React from 'react'
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import RunDisplay from '../src/RunDisplay.jsx'
let draw, stop, request, capture
beforeEach(() => {
 vi.useFakeTimers()
 Object.defineProperty(document, 'hidden', { configurable: true, value: false })
 Object.defineProperty(document, 'pictureInPictureEnabled', { configurable: true, value: true })
 Object.defineProperty(document, 'pictureInPictureElement', { configurable: true, writable: true, value: null })
 draw = vi.fn(); stop = vi.fn()
 vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({fillRect:vi.fn(),fillText:draw})
 capture = vi.fn(() => ({ getTracks: () => [{stop}], getVideoTracks: () => [] }))
 Object.defineProperty(HTMLCanvasElement.prototype, 'captureStream', { configurable: true, value: capture })
 request = vi.fn(async function () { document.pictureInPictureElement = this })
 Object.defineProperty(HTMLVideoElement.prototype, 'requestPictureInPicture', { configurable: true, value: request })
 Object.defineProperty(document, 'exitPictureInPicture', { configurable: true, value: vi.fn(async () => { document.pictureInPictureElement = null }) })
 vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
 vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })
test('PIP uses an explicit tap, displays paused on hiding, and releases media on exit', async () => {
 const {container, unmount} = render(<RunDisplay elapsed={65} distance={125} nearest={20} paused={false} />)
 fireEvent.click(screen.getByRole('button', {name:'화면 · PIP'}))
 fireEvent.click(screen.getByRole('button', {name:'PIP 준비'}))
 expect(request).not.toHaveBeenCalled()
 fireEvent.loadedData(container.querySelector('video'))
 await act(async () => fireEvent.click(screen.getByRole('button', {name:'PIP 열기'})))
 expect(request).toHaveBeenCalledOnce()
 Object.defineProperty(document, 'hidden', { configurable: true, value: true })
 act(() => document.dispatchEvent(new Event('visibilitychange')))
 expect(draw).toHaveBeenCalledWith('일시정지 · 게임 화면으로 돌아오세요', 24, 48)
 unmount(); expect(stop).toHaveBeenCalled(); expect(document.exitPictureInPicture).toHaveBeenCalledOnce()
})
test('unsupported PIP shows fallback and never allocates a stream', () => {
 Object.defineProperty(document, 'pictureInPictureEnabled', { configurable: true, value: false })
 render(<RunDisplay elapsed={0} distance={0} nearest={null} paused={false} />)
 fireEvent.click(screen.getByRole('button', {name:'화면 · PIP'}))
 expect(screen.getByText(/러닝 현황 PIP를 지원하지/)).toBeTruthy()
 expect(capture).not.toHaveBeenCalled()
})
test('PIP rejection is visible and leaves the game controls usable', async () => {
 request.mockRejectedValue(new Error('unsupported stream'))
 const {container} = render(<RunDisplay elapsed={0} distance={0} nearest={null} paused={false} />)
 fireEvent.click(screen.getByRole('button', {name:'화면 · PIP'})); fireEvent.click(screen.getByRole('button', {name:'PIP 준비'}))
 fireEvent.loadedData(container.querySelector('video'))
 await act(async () => fireEvent.click(screen.getByRole('button', {name:'PIP 열기'})))
 expect(screen.getByRole('alert').textContent).toContain('PIP를 열지 못했어요')
})
