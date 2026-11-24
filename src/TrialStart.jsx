import { useState } from 'react'
import GameIcon from './GameIcon.jsx'
import TrialBoard from './TrialBoard.jsx'
import { TRIAL_DURATIONS_SEC, DEFAULT_TRIAL_SEC, TRIAL_NAME_MAX, TRIAL_PACE_IDX, loadTrialName } from './lib/trial.js'
import { PACE_PRESETS } from './lib/gameConfig.js'
import { SOUND_PACKS, DEFAULT_SOUND_PACK } from './lib/zombieSound.js'
import { TRIAL_PACE_BONUS } from './lib/trialApi.js'
import { trialBoard } from './lib/trialApi.js'

const durationLabel = sec => (sec < 60 ? `${sec}초` : `${sec / 60}분`)

// 로그인 없이 바로 해 보는 짧은 생존 판 — 실내(탭)/실외(GPS)와 시간만 고른다
// ranking 이 켜져 있으면 이름을 받아 오늘 순위에 올린다 (이름을 비우면 순위 없이 체험만)
export default function TrialStart({ onStart, onBack, starting, error, initial, ranking = false, onPreviewSound }) {
  const [indoor, setIndoor] = useState(initial?.indoor ?? true)
  const [seconds, setSeconds] = useState(initial?.seconds ?? DEFAULT_TRIAL_SEC)
  const [swing, setSwing] = useState(initial?.swing ?? false)
  const [soundPack, setSoundPack] = useState(initial?.soundPack ?? DEFAULT_SOUND_PACK)
  const [paceIdx, setPaceIdx] = useState(initial?.paceIdx ?? TRIAL_PACE_IDX)
  const [name, setName] = useState(initial?.name ?? loadTrialName())
  const [board, setBoard] = useState(null) // { key, rows | error }
  const boardKey = `${indoor}:${seconds}`
  const showBoard = () => {
    if (board?.key === boardKey && !board.loading) return setBoard(null)
    setBoard({ key: boardKey, loading: true })
    trialBoard(indoor, seconds).then(rows => setBoard(b => b?.key === boardKey ? { key: boardKey, rows } : b),
      e => setBoard(b => b?.key === boardKey ? { key: boardKey, error: e.message } : b))
  }
  return (
    <div className="zr-screen zr-start">
      <div className="zr-start-card zr-trial-card">
        <p className="zr-eyebrow">TRY IT NOW / NO LOGIN</p>
        <h1 className="zr-title">좀비런 {durationLabel(seconds)} 체험</h1>
        <p className="zr-subtitle">좀비가 뒤에서 쫓아와요. {durationLabel(seconds)} 동안 잡히지 않고 버티면 성공!</p>

        <p className="zr-pace-label">어디서 해 볼까요?</p>
        <div className="zr-trial-modes">
          <button className={indoor ? 'zr-trial-mode zr-trial-mode-on' : 'zr-trial-mode'} aria-pressed={indoor} onClick={() => setIndoor(true)}>
            <strong>👆 실내</strong>
            <span>제자리에서 탭하거나 팔을 흔들어 달려요</span>
          </button>
          <button className={!indoor ? 'zr-trial-mode zr-trial-mode-on' : 'zr-trial-mode'} aria-pressed={!indoor} onClick={() => setIndoor(false)}>
            <strong>🏃 실외</strong>
            <span>밖에서 진짜로 달리기 — GPS로 내 위치가 움직여요</span>
          </button>
        </div>

        {indoor && <>
          <p className="zr-pace-label">실내에서 달리는 방법</p>
          <div className="zr-trial-modes">
            <button className={!swing ? 'zr-trial-mode zr-trial-mode-on' : 'zr-trial-mode'} aria-pressed={!swing} onClick={() => setSwing(false)}>
              <strong>👟 탭</strong>
              <span>화면의 큰 버튼을 빠르게 연타 — 한 번 = 50cm</span>
            </button>
            <button className={swing ? 'zr-trial-mode zr-trial-mode-on' : 'zr-trial-mode'} aria-pressed={swing} onClick={() => setSwing(true)}>
              <strong>💪 팔 흔들기</strong>
              <span>휴대폰을 쥐고 달리듯 팔을 앞뒤로 — 한 번 흔들 때 80cm</span>
            </button>
          </div>
        </>}

        <p className="zr-pace-label">버틸 시간</p>
        <div className="zr-pace-picker zr-pace-picker-3col">
          {TRIAL_DURATIONS_SEC.map(sec => (
            <button key={sec} aria-pressed={seconds === sec} className={seconds === sec ? 'zr-pace-btn zr-pace-btn-on' : 'zr-pace-btn'}
              onClick={() => setSeconds(sec)}>{durationLabel(sec)}</button>
          ))}
        </div>
        <p className="zr-pace-label">좀비 속도</p>
        <div className="zr-pace-picker">
          {PACE_PRESETS.map((p, i) => (
            <button key={p.label} aria-pressed={paceIdx === i} className={paceIdx === i ? 'zr-pace-btn zr-pace-btn-on' : 'zr-pace-btn'}
              onClick={() => setPaceIdx(i)}>{p.label.replace('/km', '')}{ranking && TRIAL_PACE_BONUS[i] > 1 && <small> ×{TRIAL_PACE_BONUS[i]}</small>}</button>
          ))}
        </div>
        <p className="zr-pace-label">좀비 소리 <small>(누르면 미리 들려요)</small></p>
        <div className="zr-pace-picker zr-sound-picker">
          {Object.entries(SOUND_PACKS).map(([key, pack]) => (
            <button key={key} aria-pressed={soundPack === key} className={soundPack === key ? 'zr-pace-btn zr-pace-btn-on' : 'zr-pace-btn'}
              onClick={() => { setSoundPack(key); onPreviewSound?.(key) }}>{key} · {pack.label}{key === DEFAULT_SOUND_PACK && <small> 기본</small>}</button>
          ))}
        </div>
        <p className="zr-mode-description">생명 3개 · 좀비에 닿으면 하나씩 줄어요.{ranking ? '' : ' 기록은 저장되지 않아요.'}</p>

        {ranking && <>
          <label className="zr-pace-label" htmlFor="zr-trial-name">이름 (오늘 순위에 보여요)</label>
          <input id="zr-trial-name" className="zr-admin-input zr-trial-name" value={name} maxLength={TRIAL_NAME_MAX} placeholder="예: 3반 김민수"
            autoComplete="off" onChange={e => setName(e.target.value)} />
        </>}

        {error && <p className="zr-error" role="alert">{error}</p>}
        <button className="zr-btn zr-btn-primary" disabled={starting} onClick={() => onStart({ indoor, swing: indoor && swing, seconds, paceIdx, soundPack, name: name.trim() })}>
          <GameIcon name="run" size={21} />
          <span>{starting ? (indoor ? '준비 중…' : '위치 확인 중…') : '체험 시작'}</span>
        </button>
        {ranking && <button className="zr-btn zr-btn-ghost" aria-expanded={board?.key === boardKey} onClick={showBoard}>
          {board?.key === boardKey ? '순위 닫기' : '오늘 순위 보기'}</button>}
        {ranking && board?.key === boardKey && <TrialBoard indoor={indoor} seconds={seconds} board={board.rows} myName={name.trim()}
          state={board.loading ? 'saving' : ''} error={board.error} />}
        {onBack && <button className="zr-btn zr-btn-ghost" disabled={starting} onClick={onBack}>진짜 좀비런 화면으로</button>}
        {ranking && !name.trim() && <p className="zr-location-note">이름을 비우면 순위 없이 체험만 해요.</p>}
        <p className="zr-location-note">{indoor ? (swing ? '아이폰은 시작할 때 "동작 및 방향" 접근을 허용해 주세요. ' : '') + '좀비가 가까이 오면 진동이 울려요 (아이폰은 진동 대신 버튼이 빨갛게 깜빡여요).' : '위치 권한이 필요해요 · 야외에서 시작해주세요.'}</p>
      </div>
    </div>
  )
}
