import { useState } from 'react'
import { supabase } from './lib/supabaseClient.js'

// 관리자 계정(이메일/비밀번호)으로 로그인해야 좀비 경로 편집 화면에 들어갈 수 있게 하는 화면.
// 계정은 Supabase 대시보드 Authentication에서 미리 만들어둬야 함(README 참고)
export default function AdminLogin({ onBack }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

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

  return (
    <div className="zr-screen zr-start">
      <div className="zr-start-card">
        <h1 className="zr-title">🔒 관리자 로그인</h1>
        <p className="zr-subtitle">좀비 경로를 만들거나 수정/삭제하려면 관리자 계정으로 로그인해야 해요.</p>
        <input
          className="zr-admin-input"
          type="email"
          placeholder="관리자 이메일"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && login()}
        />
        <input
          className="zr-admin-input"
          type="password"
          placeholder="비밀번호"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && login()}
        />
        {error && <p className="zr-error">{error}</p>}
        <button className="zr-btn zr-btn-primary" onClick={login} disabled={busy}>
          {busy ? '로그인 중…' : '로그인'}
        </button>
        <button className="zr-btn zr-btn-ghost" onClick={onBack}>
          돌아가기
        </button>
      </div>
    </div>
  )
}
