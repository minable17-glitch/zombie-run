const LINK_URL = 'https://running-journal-wine.vercel.app/api/zombie-run/link'

export async function linkSchoolAccount({ studentNumber, name, pin, zombieRunnerId, zombieNickname }) {
  let res
  try {
    res = await fetch(LINK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentNumber, name, pin, zombieRunnerId, zombieNickname }),
    })
  } catch {
    throw Error('매 1런 서버에 연결하지 못했어요. 네트워크를 확인하고 다시 시도해주세요.')
  }
  let data = null
  try { data = await res.json() } catch { /* fall through to status-based error below */ }
  if (res.status === 409) throw Error('이 계정은 이미 다른 학생과 연결돼 있어요.')
  if (!data || !data.ok) throw Error(data?.error || '학번, 이름, 비밀번호를 확인해주세요.')
  return data
}
