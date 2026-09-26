import { useEffect, useRef, useState } from 'react'
import { createScreenWake } from './lib/screenWake.js'
import { formatTime } from './lib/gameEngine.js'
import { formatDistance } from './lib/geo.js'

export default function RunDisplay({ elapsed, distance, nearest, paused }) {
  const [open, setOpen] = useState(false)
  const [wakeWanted, setWakeWanted] = useState(true)
  const [wakeStatus, setWakeStatus] = useState('off')
  const [pip, setPip] = useState(false)
  const [ready, setReady] = useState(false)
  const [message, setMessage] = useState('')
  const [preparing, setPreparing] = useState(false)
  const wake = useRef(null), video = useRef(null), canvas = useRef(null)
  const stream = useRef(null), busy = useRef(false), mounted = useRef(false)
  const snapshot = useRef({ elapsed, distance, nearest, paused })
  snapshot.current = { elapsed, distance, nearest, paused }
  const supported = typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
    ((document.pictureInPictureEnabled && typeof HTMLVideoElement.prototype.requestPictureInPicture === 'function') ||
      typeof HTMLVideoElement.prototype.webkitSetPresentationMode === 'function')

  useEffect(() => {
    const controller = createScreenWake(setWakeStatus)
    wake.current = controller
    controller.setEnabled(true)
    return () => controller.dispose()
  }, [])

  useEffect(() => {
    mounted.current = true
    const v = video.current
    const leave = () => { if (mounted.current) { setPip(false); setPreparing(false); setReady(false) } }
    const change = () => { if (mounted.current) setPip(v.webkitPresentationMode === 'picture-in-picture') }
    v.addEventListener('leavepictureinpicture', leave)
    v.addEventListener('webkitpresentationmodechanged', change)
    return () => {
      mounted.current = false
      v.removeEventListener('leavepictureinpicture', leave)
      v.removeEventListener('webkitpresentationmodechanged', change)
      if (document.pictureInPictureElement === v) void document.exitPictureInPicture().catch(() => {})
      if (v.webkitPresentationMode === 'picture-in-picture') v.webkitSetPresentationMode('inline')
      if (v.srcObject) v.pause()
      stream.current?.getTracks().forEach(track => track.stop())
      v.srcObject = null
    }
  }, [])

  // Prepare the video before the user's second tap so opening PiP retains user activation.
  useEffect(() => {
    if (!preparing) return
    const v = video.current, c = canvas.current
    let timer, timeout, active = true
    const draw = () => {
      const ctx = c.getContext('2d')
      if (!ctx) throw new Error('canvas unavailable')
      const s = snapshot.current
      const stopped = document.hidden || s.paused
      ctx.fillStyle = '#101820'; ctx.fillRect(0, 0, 640, 360)
      ctx.fillStyle = stopped ? '#ffad80' : '#80dbfa'
      ctx.font = 'bold 24px sans-serif'
      ctx.fillText(stopped ? '일시정지 · 게임 화면으로 돌아오세요' : 'ZOMBIE RUN · 러닝 현황', 24, 48)
      const values = [[formatTime(s.elapsed), '생존 시간'], [formatDistance(s.distance), '달린 거리'],
        [s.nearest == null ? '—' : formatDistance(s.nearest), '좀비 거리']]
      values.forEach(([value, label], i) => {
        ctx.fillStyle = '#f1f4f7'; ctx.font = 'bold 38px sans-serif'; ctx.fillText(value, 24 + i * 210, 135)
        ctx.fillStyle = '#acb9c8'; ctx.font = '20px sans-serif'; ctx.fillText(label, 24 + i * 210, 177)
      })
      ctx.fillStyle = '#ffad80'; ctx.font = '20px sans-serif'
      ctx.fillText('화면 잠금·앱 전환 시 추적과 기록이 멈춥니다.', 24, 250)
      ctx.fillStyle = '#acb9c8'; ctx.font = '18px sans-serif'
      ctx.fillText('마지막 갱신 ' + new Date().toLocaleTimeString('ko-KR'), 24, 310)
      stream.current?.getVideoTracks()[0]?.requestFrame?.()
    }
    const fail = () => {
      if (active && mounted.current) { setMessage('이 브라우저에서는 PIP 영상을 준비할 수 없어요.'); setPreparing(false); setReady(false) }
    }
    const loaded = () => { clearTimeout(timeout); if (mounted.current) setReady(true) }
    v.addEventListener('loadeddata', loaded)
    v.addEventListener('error', fail)
    try {
      draw()
      stream.current = c.captureStream(2)
      v.srcObject = stream.current
      void v.play().catch(fail)
      timer = setInterval(draw, 500)
      timeout = setTimeout(() => { if (v.readyState < 2) fail() }, 6000)
      document.addEventListener('visibilitychange', draw)
    } catch { fail() }
    return () => {
      active = false
      clearInterval(timer); clearTimeout(timeout)
      document.removeEventListener('visibilitychange', draw)
      v.removeEventListener('loadeddata', loaded); v.removeEventListener('error', fail)
      v.pause(); stream.current?.getTracks().forEach(track => track.stop()); stream.current = null; v.srcObject = null
    }
  }, [preparing])

  const togglePip = async () => {
    if (busy.current) return
    busy.current = true
    setMessage('')
    const v = video.current
    try {
      if (document.pictureInPictureElement === v) await document.exitPictureInPicture()
      else if (v.webkitPresentationMode === 'picture-in-picture') v.webkitSetPresentationMode('inline')
      else if (document.pictureInPictureEnabled && v.requestPictureInPicture) await v.requestPictureInPicture()
      else v.webkitSetPresentationMode('picture-in-picture')
      if (!mounted.current) {
        if (document.pictureInPictureElement === v) await document.exitPictureInPicture()
        return
      }
      setPip(document.pictureInPictureElement === v || v.webkitPresentationMode === 'picture-in-picture')
    } catch {
      if (mounted.current) setMessage('PIP를 열지 못했어요. 브라우저의 PIP 지원과 설정을 확인해주세요.')
    } finally { busy.current = false }
  }
  const labels = { on: '화면 켜짐 유지 중', off: '자동 꺼짐 허용', requesting: '화면 켜짐 유지 요청 중',
    released: '화면 켜짐 유지 해제됨', unavailable: '화면 켜짐 유지 요청 실패', unsupported: '화면 켜짐 유지 미지원' }
  return <aside className="zr-display-tools" aria-label="화면 설정">
    <button className="zr-display-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>화면 · PIP</button>
    {open && <div className="zr-display-panel">
      <strong>러닝 화면 설정</strong>
      <p role="status">{labels[wakeStatus]}</p>
      <button className="zr-btn zr-btn-ghost" disabled={wakeStatus === 'unsupported'} aria-pressed={wakeWanted} onClick={() => {
        const next = wakeStatus === 'unavailable' || wakeStatus === 'released' ? true : !wakeWanted
        setWakeWanted(next); wake.current.setEnabled(next)
      }}>{wakeStatus === 'unavailable' || wakeStatus === 'released' ? '화면 켜짐 유지 다시 요청' : wakeWanted ? '화면 켜짐 유지 끄기' : '화면 켜짐 유지 켜기'}</button>
      {supported ? <button className="zr-btn zr-btn-ghost" disabled={preparing && !ready} onClick={() => {
        if (!preparing) { setMessage(''); setReady(false); setPreparing(true) } else void togglePip()
      }}>{!preparing ? 'PIP 준비' : !ready ? 'PIP 준비 중…' : pip ? 'PIP 닫기' : 'PIP 열기'}</button>
        : <p>이 브라우저는 러닝 현황 PIP를 지원하지 않아요.</p>}
      <p>화면 켜짐 유지는 자동 잠금만 방지해요. 직접 화면을 끄거나 다른 앱으로 이동하면 러닝이 일시정지돼요. PIP도 백그라운드 추적을 켜지는 않아요.</p>
      {message && <p role="alert">{message}</p>}
    </div>}
    <canvas ref={canvas} width="640" height="360" hidden />
    <video ref={video} muted playsInline aria-hidden="true" className="zr-pip-source" />
  </aside>
}
import './runDisplay.css'
