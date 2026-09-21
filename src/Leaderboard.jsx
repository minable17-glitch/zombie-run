import { rankPlayers } from './lib/leaderboard.js'
import { formatTime } from './lib/gameEngine.js'
import { formatDistance } from './lib/geo.js'

export default function Leaderboard({ players, playerId, error, title = '이 방의 생존 랭킹' }) {
  const ranked = rankPlayers(players)
  const own = ranked.find(p => p.id === playerId)
  return <section className="zr-ranking" aria-label={title}>
    <div className="zr-ranking-summary"><span>{title}</span><strong>{own ? `내 순위 ${own.rank}위 / ${ranked.length}명` : '순위 확인 중'}</strong></div>
    <p className="zr-ranking-note">생존 시간 순 · 동률이면 이동 거리 · 같은 기록은 공동 순위</p>
    {error && <p className="zr-error" role="status">{error}</p>}
    {!ranked.length && <p role="status">참가자 기록을 불러오는 중…</p>}
    <ol className="zr-ranking-list">
      {ranked.map(p => <li key={p.id} className={p.id === playerId ? 'zr-ranking-row zr-ranking-me' : 'zr-ranking-row'}>
        <strong className="zr-ranking-place">{p.rank}<small>위</small></strong>
        <div className="zr-ranking-runner"><strong>{p.nickname}{p.id === playerId ? ' (나)' : ''}</strong>
          <small>{p.status === 'caught' ? '탈락' : p.status === 'finished' ? '종료' : '진행 중'} · {formatDistance(p.distance_m)}</small></div>
        <strong className="zr-ranking-time">{formatTime(p.elapsed_sec)}</strong>
      </li>)}
    </ol>
    <p className="zr-ranking-note">약 5초마다 갱신 · 진행 중에는 순위가 바뀔 수 있어요.</p>
  </section>
}
