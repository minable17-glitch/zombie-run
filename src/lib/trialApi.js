import { supabase } from './supabaseClient.js'

// 체험 판 순위 — 로그인 없이(anon) 부른다. 이름·판 설정은 시작 때, 결과는 끝날 때 한 번.
async function call(name, args) {
  if (!supabase) throw Error('순위 서버에 연결할 수 없어요.')
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw Error(error.code === 'PGRST202' ? '체험 순위 기능을 준비 중이에요.'
    : /fetch|network/i.test(error.message) ? '순위 서버에 연결할 수 없어요. 인터넷 연결을 확인해주세요.' : error.message)
  return data
}
export const trialStart = (name, indoor, seconds) => call('zr_trial_start', { p_name:name, p_indoor:indoor, p_seconds:seconds })
export const trialFinish = (id, r) => call('zr_trial_finish', { p_id:id, p_survived:Math.floor(r.survived), p_lives:Math.floor(r.lives), p_distance:Math.floor(r.distance) })
export const trialBoard = (indoor, seconds) => call('zr_trial_board', { p_indoor:indoor, p_seconds:seconds, p_limit:20 })

// 점수 = 버틴 초 × 10 + 남은 생명 × 100(끝까지 버텼을 때만) + 달린 거리(m) — 서버(zr_trial_finish)와 같은 식
export function trialScore({ survived, lives, distance, seconds }) {
  const s = Math.max(0, Math.min(Math.floor(survived), seconds))
  return s * 10 + (s >= seconds ? Math.max(0, Math.min(3, lives)) * 100 : 0) + Math.max(0, Math.floor(distance))
}
