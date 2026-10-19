import { rankPlayers } from './lib/leaderboard.js'
import { formatTime } from './lib/gameEngine.js'
import { formatDistance } from './lib/geo.js'

export default function Leaderboard({ players, playerId, error, title = '이 방의 생존 랭킹', goalM = 0, goalSec = 0, goalPaceSec = 0 }) {
  const ranked = rankPlayers(players, goalM, goalSec, goalPaceSec)
  const own = ranked.find(p => p.id === playerId)
  const note = goalM > 0 ? `목표 ${formatDistance(goalM)} 도달 시간 순 · 아직 도달 전이면 이동 거리 순`
    : goalSec > 0 ? `목표 ${formatTime(goalSec)} 동안 달린 거리 순 · 아직 도달 전이면 이동 거리 순`
    : goalPaceSec > 0 ? `목표 페이스 ${formatTime(goalPaceSec)} 유지 도달 시간 순 · 아직 도달 전이면 이동 거리 순`
    : '생존 시간 순 · 동률이면 이동 거리 · 같은 기록은 공동 순위'
  return <section className="zr-ranking" aria-label={title}>
    <div className="zr-ranking-summary"><span>{title}</span><strong>{own ? `내 순위 ${own.rank}위 / ${ranked.length}명` : '순위 확인 중'}</strong></div>
    <p className="zr-ranking-note">{note}</p>
    {error && <p className="zr-error" role="status">{error}</p>}
    {!ranked.length && <p role="status">참가자 기록을 불러오는 중…</p>}
    <ol className="zr-ranking-list">
      {ranked.map(p => <li key={p.id} className={p.id === playerId ? 'zr-ranking-row zr-ranking-me' : 'zr-ranking-row'}>
        <strong className="zr-ranking-place">{p.rank}<small>위</small></strong>
        <div className="zr-ranking-runner"><strong>{p.nickname}{p.id === playerId ? ' (나)' : ''}</strong>
          <small>{p.status === 'caught' ? '탈락' : p.status === 'finished' ? '종료' : '진행 중'} · {formatDistance(p.distance_m)}</small></div>
        <strong className="zr-ranking-time">{
          goalM > 0 ? (p.goal_reached_sec == null ? '도달 전' : formatTime(p.goal_reached_sec))
          : goalSec > 0 ? (p.goal_reached_m == null ? '도달 전' : formatDistance(p.goal_reached_m))
          : goalPaceSec > 0 ? (p.pace_reached_sec == null ? '도달 전' : formatTime(p.pace_reached_sec))
          : formatTime(p.elapsed_sec)
        }</strong>
      </li>)}
    </ol>
    <p className="zr-ranking-note">약 5초마다 갱신 · 진행 중에는 순위가 바뀔 수 있어요.</p>
  </section>
}
