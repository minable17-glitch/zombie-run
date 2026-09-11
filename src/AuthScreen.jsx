import { useRef, useState } from 'react'
import { supabase } from './lib/supabaseClient.js'
import { authRequest, loginWithUsername, normalizeUsername, siteUrl } from './lib/authHelpers.js'

const USERNAME_RE = /^[a-z0-9_]{3,20}$/
export default function AuthScreen({ onBack }) {
  const [tab, setTab] = useState('login')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const switchTab = next => { setTab(next); setError(''); setMessage('') }
  const submit = async event => {
    event.preventDefault()
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError('')
    setMessage('')
    try {
      if (tab === 'login') {
        await loginWithUsername(username, password)
      } else if (tab === 'signup') {
        const normalized = normalizeUsername(username)
        if (!USERNAME_RE.test(normalized)) throw new Error('아이디는 영문/숫자/밑줄로 3~20자여야 해요.')
        if (password.length < 8) throw new Error('비밀번호는 8자 이상으로 해주세요.')
        const { data, error } = await supabase.auth.signUp({
          email: email.trim().toLowerCase(), password,
          options: { data: { username: normalized, app: 'zombie-run' }, emailRedirectTo: siteUrl() },
        })
        if (error) throw new Error(error.code === 'user_already_exists'
          ? '이미 가입된 이메일이에요. 로그인하거나 계정을 복구해주세요.'
          : '가입하지 못했어요. 아이디 중복 여부와 입력 내용을 확인해주세요.')
        if (!data.session) {
          setTab('login')
          setMessage('인증 메일을 확인한 뒤 로그인해주세요.')
        }
      } else {
        await authRequest(tab === 'findId' ? 'recover' : 'reset',
          tab === 'findId' ? { email: email.trim().toLowerCase() } : { username: normalizeUsername(username) })
        setMessage(tab === 'findId'
          ? '가입된 이메일이라면 로그인 링크를 보냈어요. 링크로 접속하면 내 아이디를 확인할 수 있어요.'
          : '가입된 아이디라면 비밀번호 재설정 메일을 보냈어요. 메일함을 확인해주세요.')
      }
    } catch (e) { setError(e.message || '요청을 처리하지 못했어요.') }
    finally { busyRef.current = false; setBusy(false) }
  }
  const labels = { login: '로그인', signup: '계정 만들기', findId: '아이디 찾기', forgot: '비번 찾기' }
  return (
    <div className="zr-screen zr-start"><div className="zr-start-card">
      <h1 className="zr-title">계정</h1>
      <p className="zr-subtitle">로그인하면 나만의 좀비 경로를 만들고 수정할 수 있어요.</p>
      <div className="zr-pace-picker" style={{ marginBottom: 14 }}>
        {Object.entries(labels).map(([key, label]) =>
          <button key={key} disabled={busy} aria-pressed={tab === key}
            className={tab === key ? 'zr-pace-btn zr-pace-btn-on' : 'zr-pace-btn'}
            onClick={() => switchTab(key)}>{label}</button>)}
      </div>
      <form onSubmit={submit}>
        {tab !== 'findId' && <label>아이디
          <input className="zr-admin-input" required value={username} disabled={busy}
            autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            maxLength={20} onChange={e => setUsername(e.target.value)} />
        </label>}
        {(tab === 'signup' || tab === 'findId') && <label>이메일
          <input className="zr-admin-input" required type="email" autoComplete="email"
            value={email} disabled={busy} maxLength={254} onChange={e => setEmail(e.target.value)} />
        </label>}
        {(tab === 'login' || tab === 'signup') && <label>비밀번호
          <input className="zr-admin-input" required type="password" value={password} disabled={busy}
            autoComplete={tab === 'signup' ? 'new-password' : 'current-password'}
            minLength={tab === 'signup' ? 8 : undefined} maxLength={256}
            onChange={e => setPassword(e.target.value)} />
        </label>}
        {error && <p role="alert" className="zr-error">{error}</p>}
        {message && <p role="status" className="zr-pace-hint">{message}</p>}
        <button className="zr-btn zr-btn-primary" disabled={busy}>
          {busy ? '처리 중…' : tab === 'findId' ? '이메일로 계정 복구' : labels[tab]}
        </button>
      </form>
      <button className="zr-btn zr-btn-ghost" disabled={busy} onClick={onBack}>돌아가기</button>
    </div></div>
  )
}
