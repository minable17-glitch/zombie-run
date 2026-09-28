import { useRef, useState } from 'react'
import { linkSchoolAccount } from './lib/schoolLinkApi.js'
import { linkSchoolRunner } from './lib/runnerApi.js'

export default function SchoolLink({ runner, onLinked }) {
  const [open, setOpen] = useState(false)
  const [studentNumber, setStudentNumber] = useState('')
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [linked, setLinked] = useState(null)
  const lock = useRef(false)

  const submit = async e => {
    e.preventDefault()
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try {
      const data = await linkSchoolAccount({
        studentNumber: studentNumber.trim(), name: name.trim(), pin,
        zombieRunnerId: runner.id, zombieNickname: runner.nickname,
      })
      setLinked(data)
      setPin('')
      // 매 1런 쪽 연동은 이미 성공했으니, 우리 쪽 표시 갱신이 실패해도 사용자에게는 성공으로 보여줌
      try { onLinked?.(await linkSchoolRunner()) } catch { /* 다음 접속 때 다시 연동하면 채워짐 */ }
    } catch (e) { setError(e.message) }
    finally { lock.current = false; setBusy(false) }
  }

  return <div className="zr-school-link">
    <button className="zr-btn zr-btn-ghost" disabled={busy}
      onClick={() => { setOpen(v => !v); setError('') }}>학교 행사와 연동하기</button>
    {open && <>
      <p className="zr-ranking-note">매 1런 학번·이름·비밀번호를 입력하면 이 좀비런 닉네임({runner.nickname})의 생존 러닝 기록이 매 1런 인증 거리·점수에 합산돼요.</p>
      <form onSubmit={submit}>
        <label className="zr-personal-label">학번
          <input className="zr-admin-input" value={studentNumber} disabled={busy}
            onChange={e => setStudentNumber(e.target.value)} required />
        </label>
        <label className="zr-personal-label">이름
          <input className="zr-admin-input" value={name} disabled={busy}
            onChange={e => setName(e.target.value)} required />
        </label>
        <label className="zr-personal-label">매 1런 비밀번호
          <input className="zr-admin-input" type="password" value={pin} disabled={busy} autoComplete="off"
            onChange={e => setPin(e.target.value)} required />
        </label>
        <button className="zr-btn zr-btn-primary" disabled={busy}>{busy ? '연동 중…' : '연동하기'}</button>
      </form>
      {linked && <div className="zr-personal-code" role="status">
        <strong>{linked.className} {linked.studentName} 학생과 연동됐어요</strong>
        <p>학번·이름이 다르면 지금 다시 연동해서 바로잡을 수 있어요.</p>
      </div>}
      {error && <p className="zr-error" role="alert">{error}</p>}
    </>}
  </div>
}
