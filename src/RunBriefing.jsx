export default function RunBriefing() {
  return <section className="zr-briefing">
    <div className="zr-wordmark"><span className="zr-brand-mark">ZR</span> ZOMBIE RUN <span className="zr-edition">LIVE GPS SURVIVAL</span></div>
    <div className="zr-briefing-copy"><p className="zr-eyebrow">FIELD PROTOCOL / 01</p>
      <h1>실제 거리가,<br /><em>생존 점수</em>가 된다.</h1>
      <p>휴대폰 속 지도가 바로 게임 맵입니다.<br />달리고, 거리를 벌리고, 끝까지 살아남으세요.</p></div>
    <div className="zr-route-preview">
      <div className="zr-preview-caption"><span>TACTICAL MAP PREVIEW</span><span>GPS / ONLINE</span></div>
      <svg viewBox="0 0 540 250" role="img" aria-label="어두운 도시 지도에 생존 정보와 좀비 위치가 표시된 게임 화면 예시">
        <rect width="540" height="250" fill="#080b0e" />
        <g className="zr-city-blocks" fill="none" stroke="currentColor" strokeWidth="1.2">
          <path d="M0 48H540M0 112H540M0 184H540M70 0V250M174 0V250M286 0V250M398 0V250M492 0V250" />
          <path d="M84 61H160V99H84ZM300 125H384V170H300ZM412 61H478V99H412ZM84 197H160V238H84Z" />
        </g>
        <g className="zr-demo-stats">
          <path d="M12 10h282v35H12Z" />
          <path d="M106 10v35M200 10v35" />
          <text x="59" y="27">05:13</text><text x="153" y="27">676m</text><text x="247" y="27">89m</text>
          <text x="59" y="38">TIME</text><text x="153" y="38">DISTANCE</text><text x="247" y="38">THREAT</text>
        </g>
        <path d="M30 215H174V112H286V184H398V79H510" className="zr-preview-trail" />
        <path d="M30 215H174V112H248" className="zr-preview-chase" />
        <circle cx="398" cy="130" r="26" fill="#36d8ff" opacity=".11" />
        <circle cx="398" cy="130" r="12" fill="#071018" stroke="#46ddff" strokeWidth="2" />
        <path d="m398 121 6 16-6-3-6 3Z" fill="#f7fbff" />
        <g className="zr-demo-zombies"><circle cx="232" cy="112" r="9" /><circle cx="190" cy="112" r="7" opacity=".65" /><circle cx="286" cy="184" r="7" opacity=".8" /></g>
        <g className="zr-demo-vital"><rect x="500" y="66" width="28" height="154" rx="4" /><text x="514" y="58">VITAL</text>{[0, 1, 2, 3, 4, 5].map((i) => <rect key={i} x="505" y={72 + i * 23} width="18" height="17" rx="1" />)}</g>
        <text x="18" y="238" fill="#9aa8b2" fontSize="9">RUNNER TRAIL / LIVE</text>
      </svg>
      <div className="zr-preview-legend"><span><i />내 이동 흔적</span><span><i />좀비 경로</span></div>
    </div>
    <div className="zr-rule-strip"><div><strong>60<span>초</span></strong><p>자유 모드 첫 좀비 등장</p></div><div><strong>12<span>m</span></strong><p>좀비에게 붙잡히는 거리</p></div><div><strong>10<span>초</span></strong><p>모래시계로 좀비 정지</p></div></div>
  </section>
}
