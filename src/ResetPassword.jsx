import { useRef, useState } from 'react'
import { supabase } from './lib/supabaseClient.js'

// 비밀번호 재설정 메일의 링크를 눌러서 돌아왔을 때(Supabase가 PASSWORD_RECOVERY
// 이벤트를 보내줌) 새 비밀번호를 입력받는 화면. App.jsx가 이 이벤트를 감지해서 이 화면을 띄움
export default function ResetPassword({ onDone }) {
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (busyRef.current) return
    if (password.length < 8) {
      setError('비밀번호는 8자 이상으로 해주세요.')
      return
    }
    if (password !== password2) {
      setError('비밀번호가 서로 달라요.')
      return
    }
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      onDone()
    } catch {
      setError('비밀번호를 변경하지 못했어요. 복구 링크와 연결 상태를 확인해주세요.')
    } finally { busyRef.current = false; setBusy(false) }
  }

  return (
    <div className="zr-screen zr-start">
      <div className="zr-start-card">
        <h1 className="zr-title">🔑 새 비밀번호 설정</h1>
        <p className="zr-subtitle">새로 쓸 비밀번호를 입력해주세요.</p>
        <input
          className="zr-admin-input"
          type="password"
          placeholder="새 비밀번호 (8자 이상)" aria-label="새 비밀번호" disabled={busy}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <input
          className="zr-admin-input"
          type="password"
          placeholder="새 비밀번호 확인" aria-label="새 비밀번호 확인" disabled={busy}
          autoComplete="new-password"
          value={password2}
          onChange={(e) => setPassword2(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        {error && <p className="zr-error">{error}</p>}
        <button className="zr-btn zr-btn-primary" onClick={submit} disabled={busy}>
          {busy ? '저장 중…' : '비밀번호 바꾸기'}
        </button>
      </div>
    </div>
  )
}
