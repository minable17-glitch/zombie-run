import { formatTime, paceMissionLabel } from './lib/gameEngine.js'
import { formatDistance } from './lib/geo.js'
import { PACE_PRESETS, AREA_RADIUS_PRESETS } from './lib/gameConfig.js'

export default function PersonalBoard({ board, config, result, error }) {
  const own = board?.me
  const goalM = config.missionGoalM || 0
  const goalSec = config.missionGoalSec || 0
  const paceKind = config.missionPaceKind || 0
  const paceGoal = config.missionPaceGoal || 0
  const paceLabel = paceKind > 0 ? paceMissionLabel(paceKind, paceGoal) : ''
  const metricOf = r => goalM > 0 ? r?.goal_reached_sec : goalSec > 0 ? r?.goal_reached_m : paceKind > 0 ? r?.pace_score : r?.elapsed_sec
  const formatMetric = v => v == null ? '도달 전' : paceKind > 0 ? `${v}점` : goalSec > 0 ? formatDistance(v) : formatTime(v)
  return <section className="zr-ranking" aria-label="개인 생존 랭킹">
    {result && <div className="zr-personal-achievement">
      {goalM > 0 ? <>
        <strong>{result.goal_reached_sec == null ? '아직 목표 거리에 도달하지 못했어요' : result.is_best ? '개인 최고 완주 기록!' : '목표 거리 도달!'}</strong>
        <p>{result.goal_reached_sec == null ? `목표 ${formatDistance(goalM)} 중 ${formatDistance(result.distance_m)}까지 달렸어요.`
          : `${formatDistance(goalM)}을 ${formatTime(result.goal_reached_sec)}에 완주했어요.`}</p>
      </> : goalSec > 0 ? <>
        <strong>{result.goal_reached_m == null ? '아직 목표 시간을 채우지 못했어요' : result.is_best ? '개인 최고 기록!' : '목표 시간 도달!'}</strong>
        <p>{result.goal_reached_m == null ? `목표 ${formatTime(goalSec)} 중 ${formatTime(result.elapsed_sec)}까지 달렸어요.`
          : `${formatTime(goalSec)} 동안 ${formatDistance(result.goal_reached_m)}를 달렸어요.`}</p>
      </> : paceKind > 0 ? <>
        <strong>{paceKind !== 3 && !result.pace_cleared ? '에너지가 바닥났어요 — 순위에는 완주한 판만 들어가요'
          : result.is_best ? '개인 최고 점수!' : paceKind === 3 ? '수고했어요!' : '페이스 유지 완주!'}</strong>
        <p>{`${result.pace_score ?? 0}점 · ${formatTime(result.elapsed_sec)} · ${formatDistance(result.distance_m)}`}</p>
      </> : <>
        <strong>{result.is_best ? result.previous_sec == null ? '첫 기록을 남겼어요!' : '개인 최고 기록 갱신!' : '다음 러닝에서 다시 도전!'}</strong>
        <p>{result.previous_sec == null ? '이 기록부터 나의 도전이 시작됩니다.' : result.elapsed_sec > result.previous_sec
          ? `이전 최고보다 ${formatTime(result.elapsed_sec - result.previous_sec)} 더 생존했어요.`
          : result.is_best ? '생존 시간은 같지만 더 멀리 달렸어요.' : `이전 최고 생존 시간 ${formatTime(result.previous_sec)}`}</p>
      </>}
    </div>}
    <div className="zr-ranking-summary"><span>{goalM > 0 ? `목표 ${formatDistance(goalM)} 완주 랭킹` : goalSec > 0 ? `목표 ${formatTime(goalSec)} 거리 랭킹` : paceKind > 0 ? `페이스 유지 ${paceLabel} 점수 랭킹` : '나의 최고 기록 · 전체 랭킹'}</span>
      <strong>{own ? `${own.rank}위 / ${board.total}명` : '첫 기록에 도전하세요'}</strong>
    </div>
    {own && <p className="zr-personal-best">{formatMetric(metricOf(own))} <span>{goalM > 0 ? '완주' : goalSec > 0 ? '달린 거리' : paceKind > 0 ? '최고 점수' : '생존'} · {formatDistance(own.distance_m)}</span></p>}
    <p className="zr-ranking-note">{config.mapId ? `맵 · ${config.mapName || '선택한 지도'}` : config.playMode === 'restricted' ? `제한구역 ${AREA_RADIUS_PRESETS[config.radiusIdx]}m` : '자유 모드'} · {paceKind > 0 ? '목표 페이스' : '좀비'} {PACE_PRESETS[config.paceIdx]?.label} 기준<br />{goalM > 0 ? '같은 조건끼리 비교 · 목표 거리를 완주한 사람만 순위에 포함' : goalSec > 0 ? '같은 조건끼리 비교 · 목표 시간을 채운 사람만 순위에 포함' : paceKind === 3 ? '같은 조건끼리 비교 · 1인 1개 최고 점수' : paceKind > 0 ? '같은 조건끼리 비교 · 에너지를 남기고 완주한 판만 순위에 포함' : '같은 조건끼리 비교 · 1인 1개 최고 기록 · 생존 시간, 이동 거리순'}</p>
    {error && <p className="zr-error" role="alert">{error}</p>}
    {!board && !error && <p role="status">랭킹을 불러오는 중…</p>}
    <ol className="zr-ranking-list">
      {(board?.players || []).map(p => <li key={p.id} className={`zr-ranking-row${p.id === own?.id ? ' zr-ranking-me' : ''}`}>
        <strong className="zr-ranking-place">{p.rank}<small>위</small></strong>
        <div className="zr-ranking-runner"><strong>{p.nickname}{p.id === own?.id ? ' (나)' : ''}</strong><small>{formatDistance(p.distance_m)}</small></div>
        <strong className="zr-ranking-time">{formatMetric(metricOf(p))}</strong>
      </li>)}
    </ol>
    {board?.total === 0 && <p className="zr-ranking-note">아직 기록이 없어요. 첫 번째 주인공이 되어보세요.</p>}
    {board?.total > 50 && <p className="zr-ranking-note">상위 50명 표시 · 내 순위는 순위권 밖이어도 위에 표시돼요.</p>}
    {board?.recent?.length > 0 && <details><summary>내 최근 기록 {board.recent.length}개</summary>
      <ul className="zr-ranking-list">{board.recent.map(r => <li key={r.id} className="zr-personal-history">
        <span>{new Date(r.finished_at).toLocaleDateString('ko-KR')}</span>
        <strong>{paceKind > 0 && paceKind !== 3 && !r.pace_cleared ? `${r.pace_score ?? 0}점 · 실패` : formatMetric(metricOf(r))}</strong>
        <span>{formatDistance(r.distance_m)}</span>
      </li>)}</ul>
    </details>}
  </section>
}
