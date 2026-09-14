export default function RunBriefing() {
  return <section className="zr-briefing">
    <div className="zr-wordmark"><span className="zr-brand-mark">Z</span> ZOMBIE RUN <span className="zr-edition">GPS SURVIVAL</span></div>
    <div className="zr-briefing-copy"><p className="zr-eyebrow">오늘의 러닝에, 추격을 더하다</p>
      <h1>도시는 트랙.<br />당신은 <em>생존자.</em></h1>
      <p>익숙한 길을 새로운 긴장감으로.<br />실제로 달리고, 좀비보다 오래 살아남으세요.</p></div>
    <div className="zr-route-preview">
      <div className="zr-preview-caption"><span>추격은 이렇게 시작됩니다</span><span>경로 예시</span></div>
      <svg viewBox="0 0 540 240" role="img" aria-label="달리는 사람 뒤로 좀비가 쫓아오는 경로 예시">
        <g className="zr-city-blocks" fill="none" stroke="currentColor" strokeWidth="1">
          <path d="M0 35H540M0 100H540M0 170H540M60 0V240M165 0V240M280 0V240M390 0V240M490 0V240" />
          <path d="M75 48H150V86H75ZM295 113H375V156H295ZM405 48H475V86H405ZM75 183H150V225H75Z" />
        </g>
        <path d="M25 195H165V100H280V170H390V60H510" className="zr-preview-trail" />
        <path d="M25 195H165V100H245" className="zr-preview-chase" />
        <circle cx="390" cy="110" r="24" fill="#70b9ff" opacity=".12" />
        <circle cx="390" cy="110" r="8" fill="#8dcdff" stroke="#eaf6ff" strokeWidth="3" />
        <circle cx="205" cy="100" r="6" fill="#ff9368" /><circle cx="175" cy="100" r="4" fill="#ff9368" opacity=".6" />
        <text x="410" y="115" fill="#cce8ff" fontSize="12">나</text>
        <text x="210" y="80" fill="#ffb99d" fontSize="12">추격 중</text>
        <text x="28" y="222" fill="#8f9dad" fontSize="10">START</text>
      </svg>
      <div className="zr-preview-legend"><span><i />러닝 경로</span><span><i />좀비의 추격</span></div>
    </div>
    <div className="zr-rule-strip"><div><strong>60<span>초</span></strong><p>러닝 시작 후 좀비 등장</p></div><div><strong>12<span>m</span></strong><p>좀비에게 붙잡히는 거리</p></div><div><strong>10<span>초</span></strong><p>모래시계로 좀비 정지</p></div></div>
  </section>
}
