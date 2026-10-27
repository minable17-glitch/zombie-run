import { useState } from 'react'
import GameIcon from './GameIcon.jsx'
import { TRIAL_DURATIONS_SEC, DEFAULT_TRIAL_SEC } from './lib/trial.js'

const durationLabel = sec => (sec < 60 ? `${sec}초` : `${sec / 60}분`)

// 로그인 없이 바로 해 보는 짧은 생존 판 — 실내(흔들기)/실외(GPS)와 시간만 고른다
export default function TrialStart({ onStart, onBack, starting, error, initial }) {
  const [indoor, setIndoor] = useState(initial?.indoor ?? true)
  const [seconds, setSeconds] = useState(initial?.seconds ?? DEFAULT_TRIAL_SEC)
  return (
    <div className="zr-screen zr-start">
      <div className="zr-start-card zr-trial-card">
        <p className="zr-eyebrow">TRY IT NOW / NO LOGIN</p>
        <h1 className="zr-title">좀비런 {durationLabel(seconds)} 체험</h1>
        <p className="zr-subtitle">좀비가 뒤에서 쫓아와요. {durationLabel(seconds)} 동안 잡히지 않고 버티면 성공!</p>

        <p className="zr-pace-label">어디서 해 볼까요?</p>
        <div className="zr-trial-modes">
          <button className={indoor ? 'zr-trial-mode zr-trial-mode-on' : 'zr-trial-mode'} aria-pressed={indoor} onClick={() => setIndoor(true)}>
            <strong>📳 실내</strong>
            <span>휴대폰을 손에 쥐고 제자리 뛰기 — 흔들수록 앞으로 달려요</span>
          </button>
          <button className={!indoor ? 'zr-trial-mode zr-trial-mode-on' : 'zr-trial-mode'} aria-pressed={!indoor} onClick={() => setIndoor(false)}>
            <strong>🏃 실외</strong>
            <span>밖에서 진짜로 달리기 — GPS로 내 위치가 움직여요</span>
          </button>
        </div>

        <p className="zr-pace-label">버틸 시간</p>
        <div className="zr-pace-picker zr-pace-picker-3col">
          {TRIAL_DURATIONS_SEC.map(sec => (
            <button key={sec} aria-pressed={seconds === sec} className={seconds === sec ? 'zr-pace-btn zr-pace-btn-on' : 'zr-pace-btn'}
              onClick={() => setSeconds(sec)}>{durationLabel(sec)}</button>
          ))}
        </div>
        <p className="zr-mode-description">생명 3개 · 좀비에 닿으면 하나씩 줄어요. 기록은 저장되지 않아요.</p>

        {error && <p className="zr-error" role="alert">{error}</p>}
        <button className="zr-btn zr-btn-primary" disabled={starting} onClick={() => onStart({ indoor, seconds })}>
          <GameIcon name="run" size={21} />
          <span>{starting ? (indoor ? '준비 중…' : '위치 확인 중…') : '체험 시작'}</span>
        </button>
        {onBack && <button className="zr-btn zr-btn-ghost" disabled={starting} onClick={onBack}>진짜 좀비런 화면으로</button>}
        <p className="zr-location-note">{indoor ? '흔들림 감지가 안 되는 기기에서는 화면의 "탭해서 달리기" 버튼을 연타해도 돼요.' : '위치 권한이 필요해요 · 야외에서 시작해주세요.'}</p>
      </div>
    </div>
  )
}
