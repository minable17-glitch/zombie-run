import { useState } from 'react'
import { supabase } from './lib/supabaseClient.js'

// 로그인/회원가입 화면. 계정으로 로그인하면 나만의 좀비 경로를 만들고 수정/삭제할 수
// 있음(누구나 가입 가능). 만든 경로는 다른 사람들도 로그인 없이 게임에서 바로 쓸 수
// 있고, 수정/삭제는 만든 사람 본인 계정으로 로그인해야만 가능함
export default function AuthScreen({ onBack }) {
  const [tab, setTab] = useState('login') // 'login' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [signupDone, setSignupDone] = useState(false)

  const login = async () => {
    if (!email.trim() || !password) {
      setError('이메일과 비밀번호를 모두 입력해주세요.')
      return
    }
    setBusy(true)
    setError('')
    const { error: loginError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    setBusy(false)
    if (loginError) {
      setError(loginError.message === 'Invalid login credentials' ? '이메일 또는 비밀번호가 틀렸어요.' : loginError.message)
    }
    // 성공하면 App.jsx의 onAuthStateChange가 자동으로 감지해서 화면이 넘어감
  }

  const signup = async () => {
    if (!email.trim() || !password) {
      setError('이메일과 비밀번호를 모두 입력해주세요.')
      return
    }
    if (password.length < 6) {
      setError('비밀번호는 6자 이상으로 해주세요.')
      return
    }
    setBusy(true)
    setError('')
    const { data, error: signupError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    })
    setBusy(false)
    if (signupError) {
      setError(signupError.message)
      return
    }
    // 이메일 인증이 꺼져있는 프로젝트면 가입과 동시에 세션이 생겨서 바로 화면이 넘어감.
    // 켜져있으면 세션이 없어서 안내 메시지만 보여줌
    if (!data.session) setSignupDone(true)
  }

  if (signupDone) {
    return (
      <div className="zr-screen zr-start">
        <div className="zr-start-card">
          <h1 className="zr-title">📩 이메일을 확인해주세요</h1>
          <p className="zr-subtitle">
            {email.trim()} 로 인증 메일을 보냈어요. 메일함에서 인증 링크를 눌러 확인한 뒤 로그인해주세요.
          </p>
          <button
            className="zr-btn zr-btn-primary"
            onClick={() => {
              setSignupDone(false)
              setTab('login')
              setPassword('')
            }}
          >
            로그인하러 가기
          </button>
          <button className="zr-btn zr-btn-ghost" onClick={onBack}>
            돌아가기
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="zr-screen zr-start">
      <div className="zr-start-card">
        <h1 className="zr-title">🔒 계정</h1>
        <p className="zr-subtitle">
          계정으로 로그인하면 나만의 좀비 경로를 만들고 수정/삭제할 수 있어요. 만든 경로는 다른 사람들도
          로그인 없이 게임에서 바로 쓸 수 있고, 수정/삭제는 만든 사람만 가능해요.
        </p>
        <div className="zr-pace-picker zr-pace-picker-2col" style={{ marginBottom: 14 }}>
          <button
            className={tab === 'login' ? 'zr-pace-btn zr-pace-btn-on' : 'zr-pace-btn'}
            onClick={() => {
              setTab('login')
              setError('')
            }}
          >
            로그인
          </button>
          <button
            className={tab === 'signup' ? 'zr-pace-btn zr-pace-btn-on' : 'zr-pace-btn'}
            onClick={() => {
              setTab('signup')
              setError('')
            }}
          >
            계정 만들기
          </button>
        </div>
        <input
          className="zr-admin-input"
          type="email"
          placeholder="이메일"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="zr-admin-input"
          type="password"
          placeholder={tab === 'signup' ? '비밀번호 (6자 이상)' : '비밀번호'}
          autoComplete={tab === 'signup' ? 'new-password' : 'current-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (tab === 'signup' ? signup() : login())}
        />
        {error && <p className="zr-error">{error}</p>}
        {tab === 'login' ? (
          <button className="zr-btn zr-btn-primary" onClick={login} disabled={busy}>
            {busy ? '로그인 중…' : '로그인'}
          </button>
        ) : (
          <button className="zr-btn zr-btn-primary" onClick={signup} disabled={busy}>
            {busy ? '만드는 중…' : '계정 만들기'}
          </button>
        )}
        <button className="zr-btn zr-btn-ghost" onClick={onBack}>
          돌아가기
        </button>
      </div>
    </div>
  )
}
