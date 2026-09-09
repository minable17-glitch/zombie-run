import { useState } from 'react'
import { supabase } from './lib/supabaseClient.js'
import {
  isUsernameTaken,
  lookupEmailByUsername,
  lookupUsernameByEmail,
  normalizeUsername,
  siteUrl,
} from './lib/authHelpers.js'

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/

// 로그인/회원가입/아이디찾기/비번찾기 화면. 아이디(username)로 로그인하지만 내부적으로는
// Supabase Auth(이메일 기반)를 그대로 씀 — 가입할 때 이메일도 같이 받아서 profiles
// 테이블에 아이디↔이메일을 저장해두고, 로그인/아이디찾기/비번찾기 시 그걸로 서로를 찾음.
// 계정으로 로그인하면 나만의 좀비 경로를 만들고 수정/삭제할 수 있음(누구나 가입 가능).
// 만든 경로는 다른 사람들도 로그인 없이 게임에서 바로 쓸 수 있고, 수정/삭제는 본인만 가능.
export default function AuthScreen({ onBack }) {
  const [tab, setTab] = useState('login') // 'login' | 'signup' | 'findId' | 'forgot'
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [foundUsername, setFoundUsername] = useState('')

  const switchTab = (next) => {
    setTab(next)
    setError('')
    setMessage('')
    setFoundUsername('')
  }

  const login = async () => {
    if (!username.trim() || !password) {
      setError('아이디와 비밀번호를 모두 입력해주세요.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const foundEmail = await lookupEmailByUsername(username)
      if (!foundEmail) {
        setError('존재하지 않는 아이디예요.')
        return
      }
      const { error: loginError } = await supabase.auth.signInWithPassword({ email: foundEmail, password })
      if (loginError) {
        setError(loginError.message === 'Invalid login credentials' ? '아이디 또는 비밀번호가 틀렸어요.' : loginError.message)
      }
      // 성공하면 App.jsx의 onAuthStateChange가 자동으로 감지해서 화면이 넘어감
    } catch (e) {
      setError(e?.message || '로그인 중 문제가 생겼어요.')
    } finally {
      setBusy(false)
    }
  }

  const signup = async () => {
    if (!username.trim() || !email.trim() || !password) {
      setError('아이디, 이메일, 비밀번호를 모두 입력해주세요.')
      return
    }
    if (!USERNAME_RE.test(normalizeUsername(username))) {
      setError('아이디는 영문/숫자/밑줄(_)로 3~20자여야 해요.')
      return
    }
    if (password.length < 6) {
      setError('비밀번호는 6자 이상으로 해주세요.')
      return
    }
    setBusy(true)
    setError('')
    try {
      if (await isUsernameTaken(username)) {
        setError('이미 사용 중인 아이디예요.')
        return
      }
      const { data, error: signupError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        // 아이디는 항상 소문자로 저장 — 폰 키보드의 자동 대문자화 때문에 가입 때와
        // 로그인 때 입력값이 실제로 달라져서 "존재하지 않는 아이디"로 보이는 걸 방지
        options: { data: { username: normalizeUsername(username) } },
      })
      if (signupError) {
        setError(signupError.message)
        return
      }
      // 이메일 인증이 꺼져있는 프로젝트면 가입과 동시에 세션이 생겨서 바로 화면이 넘어감.
      // 켜져있으면 세션이 없어서 안내 메시지만 보여줌
      if (!data.session) {
        setMessage(`${email.trim()} 로 인증 메일을 보냈어요. 메일함에서 링크를 눌러 확인한 뒤 로그인해주세요.`)
        switchTab('login')
      }
    } catch (e) {
      setError(e?.message || '가입 중 문제가 생겼어요.')
    } finally {
      setBusy(false)
    }
  }

  const findId = async () => {
    if (!email.trim()) {
      setError('가입할 때 쓴 이메일을 입력해주세요.')
      return
    }
    setBusy(true)
    setError('')
    setFoundUsername('')
    try {
      const found = await lookupUsernameByEmail(email)
      if (!found) {
        setError('그 이메일로 가입한 계정을 찾을 수 없어요.')
        return
      }
      setFoundUsername(found)
    } catch (e) {
      setError(e?.message || '요청 중 문제가 생겼어요.')
    } finally {
      setBusy(false)
    }
  }

  const sendResetEmail = async () => {
    if (!username.trim()) {
      setError('아이디를 입력해주세요.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const foundEmail = await lookupEmailByUsername(username)
      if (!foundEmail) {
        setError('존재하지 않는 아이디예요.')
        return
      }
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(foundEmail, {
        redirectTo: siteUrl(),
      })
      if (resetError) {
        setError(resetError.message)
        return
      }
      setMessage(`${foundEmail} 로 비밀번호 재설정 메일을 보냈어요. 메일함에서 링크를 눌러 새 비밀번호를 설정해주세요.`)
    } catch (e) {
      setError(e?.message || '요청 중 문제가 생겼어요.')
    } finally {
      setBusy(false)
    }
  }

  const submit = () => {
    if (tab === 'login') login()
    else if (tab === 'signup') signup()
    else if (tab === 'findId') findId()
    else sendResetEmail()
  }

  const submitLabel = busy
    ? '처리 중…'
    : tab === 'login'
      ? '로그인'
      : tab === 'signup'
        ? '계정 만들기'
        : tab === 'findId'
          ? '아이디 찾기'
          : '재설정 메일 보내기'

  return (
    <div className="zr-screen zr-start">
      <div className="zr-start-card">
        <h1 className="zr-title">🔒 계정</h1>
        <p className="zr-subtitle">
          계정으로 로그인하면 나만의 좀비 경로를 만들고 수정/삭제할 수 있어요. 만든 경로는 다른 사람들도
          로그인 없이 게임에서 바로 쓸 수 있고, 수정/삭제는 만든 사람만 가능해요.
        </p>
        <div className="zr-pace-picker" style={{ marginBottom: 14 }}>
          <button className={tab === 'login' ? 'zr-pace-btn zr-pace-btn-on' : 'zr-pace-btn'} onClick={() => switchTab('login')}>
            로그인
          </button>
          <button className={tab === 'signup' ? 'zr-pace-btn zr-pace-btn-on' : 'zr-pace-btn'} onClick={() => switchTab('signup')}>
            계정 만들기
          </button>
          <button className={tab === 'findId' ? 'zr-pace-btn zr-pace-btn-on' : 'zr-pace-btn'} onClick={() => switchTab('findId')}>
            아이디 찾기
          </button>
          <button className={tab === 'forgot' ? 'zr-pace-btn zr-pace-btn-on' : 'zr-pace-btn'} onClick={() => switchTab('forgot')}>
            비번 찾기
          </button>
        </div>

        {tab !== 'findId' && (
          <input
            className="zr-admin-input"
            type="text"
            placeholder="아이디 (영문/숫자/밑줄 3~20자)"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        )}
        {(tab === 'signup' || tab === 'findId') && (
          <input
            className="zr-admin-input"
            type="email"
            placeholder={tab === 'findId' ? '가입할 때 쓴 이메일' : '이메일 (비밀번호를 잊었을 때 찾는 용도)'}
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        )}
        {tab !== 'forgot' && tab !== 'findId' && (
          <input
            className="zr-admin-input"
            type="password"
            placeholder={tab === 'signup' ? '비밀번호 (6자 이상)' : '비밀번호'}
            autoComplete={tab === 'signup' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        )}
        {tab === 'forgot' && (
          <p className="zr-pace-hint" style={{ margin: '0 0 10px' }}>
            아이디를 입력하면 가입할 때 등록한 이메일로 비밀번호 재설정 링크를 보내드려요.
          </p>
        )}

        {error && <p className="zr-error">{error}</p>}
        {message && (
          <p className="zr-pace-hint" style={{ color: '#9fd8a8' }}>
            {message}
          </p>
        )}
        {foundUsername && (
          <p className="zr-pace-hint" style={{ color: '#9fd8a8' }}>
            회원님의 아이디는 <strong>{foundUsername}</strong> 입니다.
          </p>
        )}

        {foundUsername ? (
          <button
            className="zr-btn zr-btn-primary"
            onClick={() => {
              setUsername(foundUsername)
              switchTab('login')
            }}
          >
            이 아이디로 로그인하러 가기
          </button>
        ) : (
          <button className="zr-btn zr-btn-primary" onClick={submit} disabled={busy}>
            {submitLabel}
          </button>
        )}
        <button className="zr-btn zr-btn-ghost" onClick={onBack}>
          돌아가기
        </button>
      </div>
    </div>
  )
}
