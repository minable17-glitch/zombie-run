import { formatTime } from './lib/gameEngine.js'
import { formatDistance } from './lib/geo.js'
import { PACE_PRESETS, AREA_RADIUS_PRESETS } from './lib/gameConfig.js'

export default function PersonalBoard({ board, config, result, error }) {
  const own = board?.me
  return <section className="zr-ranking" aria-label="개인 생존 랭킹">
    {result && <div className="zr-personal-achievement">
      <strong>{result.is_best ? result.previous_sec == null ? '첫 기록을 남겼어요!' : '개인 최고 기록 갱신!' : '다음 러닝에서 다시 도전!'}</strong>
      <p>{result.previous_sec == null ? '이 기록부터 나의 도전이 시작됩니다.' : result.elapsed_sec > result.previous_sec
        ? `이전 최고보다 ${formatTime(result.elapsed_sec - result.previous_sec)} 더 생존했어요.`
        : result.is_best ? '생존 시간은 같지만 더 멀리 달렸어요.' : `이전 최고 생존 시간 ${formatTime(result.previous_sec)}`}</p>
    </div>}
    <div className="zr-ranking-summary"><span>나의 최고 기록 · 전체 랭킹</span>
      <strong>{own ? `${own.rank}위 / ${board.total}명` : '첫 기록에 도전하세요'}</strong>
    </div>
    {own && <p className="zr-personal-best">{formatTime(own.elapsed_sec)} <span>생존 · {formatDistance(own.distance_m)}</span></p>}
    <p className="zr-ranking-note">{config.playMode === 'restricted' ? `제한구역 ${AREA_RADIUS_PRESETS[config.radiusIdx]}m` : '자유 모드'} · 좀비 {PACE_PRESETS[config.paceIdx]?.label} 기준<br />같은 조건끼리 비교 · 1인 1개 최고 기록 · 생존 시간, 이동 거리순</p>
    {error && <p className="zr-error" role="alert">{error}</p>}
    {!board && !error && <p role="status">랭킹을 불러오는 중…</p>}
    <ol className="zr-ranking-list">
      {(board?.players || []).map(p => <li key={p.id} className={`zr-ranking-row${p.id === own?.id ? ' zr-ranking-me' : ''}`}>
        <strong className="zr-ranking-place">{p.rank}<small>위</small></strong>
        <div className="zr-ranking-runner"><strong>{p.nickname}{p.id === own?.id ? ' (나)' : ''}</strong><small>{formatDistance(p.distance_m)}</small></div>
        <strong className="zr-ranking-time">{formatTime(p.elapsed_sec)}</strong>
      </li>)}
    </ol>
    {board?.total === 0 && <p className="zr-ranking-note">아직 기록이 없어요. 첫 번째 주인공이 되어보세요.</p>}
    {board?.total > 50 && <p className="zr-ranking-note">상위 50명 표시 · 내 순위는 순위권 밖이어도 위에 표시돼요.</p>}
    {board?.recent?.length > 0 && <details><summary>내 최근 기록 {board.recent.length}개</summary>
      <ul className="zr-ranking-list">{board.recent.map(r => <li key={r.id} className="zr-personal-history">
        <span>{new Date(r.finished_at).toLocaleDateString('ko-KR')}</span><strong>{formatTime(r.elapsed_sec)}</strong><span>{formatDistance(r.distance_m)}</span>
      </li>)}</ul>
    </details>}
  </section>
}
