import { useEffect, useRef, useState } from 'react'
import { currentRunner, connectRunner, disconnectRunner, soloBoard } from './lib/runnerApi.js'
import PersonalBoard from './PersonalBoard.jsx'

export default function PersonalRunner({ config, onStart, onBack, startError }) {
  const [runner, setRunner] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('login')
  const [nickname, setNickname] = useState('')
  const [code, setCode] = useState('')
  const [newCode, setNewCode] = useState('')
  const [savedCode, setSavedCode] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [board, setBoard] = useState(null)
  const [boardError, setBoardError] = useState('')
  const active = useRef(false), lock = useRef(false)
  const refreshBoard = async () => {
    try { const data = await soloBoard(config); if (active.current) { setBoard(data); setBoardError('') } }
    catch { if (active.current) setBoardError('랭킹을 불러오지 못했어요. 다시 조회해주세요.') }
  }
  useEffect(() => {
    active.current = true
    currentRunner().then(r => { if (active.current) setRunner(r) })
      .catch(e => { if (active.current) setError(e.message) })
      .finally(() => { if (active.current) setLoading(false) })
    return () => { active.current = false }
  }, [])
  useEffect(() => { if (runner) void refreshBoard() }, [runner, config.playMode, config.paceIdx, config.radiusIdx])
  const connect = async e => {
    e.preventDefault()
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try {
      await currentRunner()
      const data = await connectRunner(nickname.trim(), tab === 'create' ? null : code)
      if (active.current) { setRunner(data.runner); setNewCode(data.code || ''); setCode(''); setSavedCode(false) }
    } catch (e) { if (active.current) setError(e.message) }
    finally { lock.current = false; if (active.current) setBusy(false) }
  }
  const start = async () => {
    if (lock.current) return
    lock.current = true; setBusy(true)
    try { await onStart(config, { soloRunner:runner }) }
    catch { if (active.current) setError('러닝을 시작하지 못했어요. 다시 시도해주세요.') }
    finally { lock.current = false; if (active.current) setBusy(false) }
  }
  return <div className="zr-screen zr-start"><div className="zr-start-card zr-personal-card">
    <p className="zr-eyebrow">SOLO SURVIVAL / PERSONAL BEST</p>
    <h1 className="zr-title">{runner ? `${runner.nickname}의 생존 러닝` : '나의 생존 기록'}</h1>
    <p className="zr-subtitle">혼자 달리고, 나의 최고 기록을 넘고, 다른 러너와 경쟁하세요.</p>
    {loading ? <p role="status">내 기록 접속 확인 중…</p> : !runner ? <>
      <div className="zr-pace-picker zr-pace-picker-2col">
        <button className={`zr-pace-btn${tab === 'login' ? ' zr-pace-btn-on' : ''}`} aria-pressed={tab === 'login'} onClick={() => { setTab('login'); setError('') }}>기존 기록 접속</button>
        <button className={`zr-pace-btn${tab === 'create' ? ' zr-pace-btn-on' : ''}`} aria-pressed={tab === 'create'} onClick={() => { setTab('create'); setError('') }}>처음이에요</button>
      </div>
      <form onSubmit={connect}>
        <label className="zr-personal-label">닉네임<input className="zr-admin-input" value={nickname} onChange={e => setNickname(e.target.value)} maxLength={20} required autoComplete="username" /></label>
        {tab === 'login' && <label className="zr-personal-label">개인 코드<input className="zr-admin-input" type="password" value={code} onChange={e => setCode(e.target.value)} required autoComplete="current-password" spellCheck={false} /></label>}
        <p className="zr-ranking-note">{tab === 'create' ? '처음 등록하면 나만의 개인 코드를 발급해요. 다른 기기에서도 같은 닉네임·코드로 기록을 이어갑니다.' : '방 코드가 아닌, 처음 등록할 때 받은 개인 코드를 입력하세요.'}</p>
        <button className="zr-btn zr-btn-primary" disabled={busy}>{busy ? '연결 중…' : tab === 'create' ? '닉네임 등록 · 개인 코드 받기' : '내 기록으로 접속'}</button>
      </form>
    </> : <>
      {newCode && <div className="zr-personal-code">
        <strong>나의 개인 코드</strong><code>{newCode.match(/.{1,4}/g).join('-')}</code>
        <p>다시 표시되지 않으니 지금 보관해주세요. 이 코드를 아는 사람은 내 기록으로 접속할 수 있어요.</p>
        <label><input type="checkbox" checked={savedCode} onChange={e => setSavedCode(e.target.checked)} /> 개인 코드를 저장했어요</label>
      </div>}
      <button className="zr-btn zr-btn-primary" disabled={busy || Boolean(newCode && !savedCode)} onClick={start}>{busy ? '출발 준비 중…' : '생존 러닝 출발'}</button>
      <PersonalBoard board={board} config={config} error={boardError} />
      <button className="zr-btn zr-btn-ghost" disabled={busy} onClick={refreshBoard}>랭킹 새로고침</button>
      <button className="zr-admin-link" disabled={busy} onClick={async () => {
        if (lock.current) return
        lock.current = true; setBusy(true)
        try { await disconnectRunner(); setRunner(null); setBoard(null); setNewCode('') }
        catch (e) { setError(e.message) }
        finally { lock.current = false; setBusy(false) }
      }}>다른 닉네임으로 접속</button>
    </>}
    {(error || startError) && <p className="zr-error" role="alert">{error || startError}</p>}
    <button className="zr-btn zr-btn-ghost" disabled={busy} onClick={onBack}>돌아가기</button>
  </div></div>
}
