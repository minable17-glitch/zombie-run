import { formatTime } from './lib/gameEngine.js'
import { formatDistance } from './lib/geo.js'

const durationLabel = sec => (sec < 60 ? `${sec}초` : `${sec / 60}분`)

// 체험 판 오늘 순위 — 같은 판(실내/실외 · 시간)끼리, 이름별 최고 점수
export default function TrialBoard({ indoor, seconds, board, me, myName, state, error }) {
  return <section className="zr-ranking" aria-label="오늘 체험 순위">
    {me && <div className="zr-personal-achievement">
      <strong>{me.score}점 · 오늘 {me.rank}위</strong>
      <p>{formatTime(me.survived)} 버팀 ×10 + 생명 {me.lives}개 ×100 + {formatDistance(me.distance)}
        {me.best > me.score ? ` · 내 최고 ${me.best}점` : ''}</p>
    </div>}
    <div className="zr-ranking-summary"><span>오늘의 순위 · {indoor ? '실내' : '실외'} {durationLabel(seconds)}</span></div>
    {state === 'saving' && <p role="status">순위에 올리는 중…</p>}
    {error && <p className="zr-error" role="alert">{error}</p>}
    {board && <ol className="zr-ranking-list">
      {board.map(p => <li key={p.name} className={`zr-ranking-row${p.name === myName ? ' zr-ranking-me' : ''}`}>
        <strong className="zr-ranking-place">{p.rank}<small>위</small></strong>
        <div className="zr-ranking-runner"><strong>{p.name}{p.name === myName ? ' (나)' : ''}</strong>
          <small>{formatTime(p.survived)} · 생명 {p.lives} · {formatDistance(p.distance)}</small></div>
        <strong className="zr-ranking-time">{p.score}점</strong>
      </li>)}
    </ol>}
    {board?.length === 0 && <p className="zr-ranking-note">오늘 첫 기록의 주인공이 되어보세요.</p>}
    <p className="zr-ranking-note">점수 = 버틴 초 ×10 + 남은 생명 ×100(끝까지 버텼을 때) + 달린 거리 1m당 1점 · 매일 새 순위</p>
  </section>
}
