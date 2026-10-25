import { useEffect, useRef, useState } from 'react'
import { PACE_ENERGY_MAX, PACE_ZONE_OK_SEC, PACE_ZONE_WARN_SEC } from './lib/gameEngine.js'

const SCALE_SEC = 60 // 게이지 끝 = 목표보다 60초/km 차이
const pct = sec => (sec / SCALE_SEC) * 50

// 페이스 유지런 세로 게이지: 왼쪽은 목표 페이스(가운데 선) 기준으로 빠르면 위·느리면 아래로 움직이는 표시,
// 오른쪽은 에너지 바. 표시는 CSS transition으로 미끄러지듯 오르내린다.
export default function PaceGauge({ diffSec, zone, energy, score }) {
  const offset = diffSec == null ? 0 : Math.max(-SCALE_SEC, Math.min(SCALE_SEC, diffSec))
  const [flash, setFlash] = useState(null)
  const lastScore = useRef(score)
  useEffect(() => {
    const delta = Math.round(score) - Math.round(lastScore.current)
    lastScore.current = score
    if (!delta) return
    setFlash(delta > 0 ? `+${delta}` : `${delta}`)
    const t = setTimeout(() => setFlash(null), 700)
    return () => clearTimeout(t)
  }, [score])
  const energyPct = Math.round((energy / PACE_ENERGY_MAX) * 100)
  const status = zone == null ? '측정 중' : zone === 'ok' ? '유지 중' : diffSec > 0 ? '느려요' : '빨라요'
  return (
    <div className={`zr-pace-gauge zr-pace-zone-${zone ?? 'wait'}`} role="group"
      aria-label={`페이스 유지 ${status}, 점수 ${Math.round(score)}, 에너지 ${energyPct}%`}>
      <div className="zr-pace-score">
        <small>SCORE</small>
        <strong>{Math.round(score)}</strong>
        {flash && <em key={flash + score} className={flash.startsWith('+') ? 'zr-score-up' : 'zr-score-down'}>{flash}</em>}
      </div>
      <div className="zr-pace-gauge-body">
        <div className="zr-pace-track" aria-hidden="true">
          <span className="zr-pace-band zr-pace-band-warn" style={{ top: `${50 - pct(PACE_ZONE_WARN_SEC)}%`, bottom: `${50 - pct(PACE_ZONE_WARN_SEC)}%` }} />
          <span className="zr-pace-band zr-pace-band-ok" style={{ top: `${50 - pct(PACE_ZONE_OK_SEC)}%`, bottom: `${50 - pct(PACE_ZONE_OK_SEC)}%` }} />
          <span className="zr-pace-center" />
          <small className="zr-pace-end zr-pace-end-top">빠름</small>
          <small className="zr-pace-end zr-pace-end-bottom">느림</small>
          {diffSec != null && <span className="zr-pace-marker" style={{ top: `${50 + pct(offset)}%` }} />}
        </div>
        <div className="zr-energy" aria-hidden="true">
          <span className="zr-energy-fill" style={{ height: `${energyPct}%` }} />
        </div>
      </div>
      <div className="zr-pace-gauge-foot">
        <strong>{status}</strong>
        <small>에너지 {energyPct}%</small>
      </div>
    </div>
  )
}
