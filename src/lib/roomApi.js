import { supabase } from './supabaseClient.js'

let guestPromise
export async function ensureRoomIdentity() {
  if (!supabase) throw new Error('그룹 연결 설정이 필요해요.')
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  if (data.session) return data.session
  if (!guestPromise) {
    guestPromise = supabase.auth.signInAnonymously().then(({ data, error }) => {
      if (error) throw new Error('참가자 연결에 실패했어요. 잠시 후 다시 시도해주세요.')
      return data.session
    }).finally(() => { guestPromise = null })
  }
  return guestPromise
}

async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw new Error(error.code === 'PGRST202'
    ? '그룹 기능을 업데이트 중이에요. 잠시 후 다시 시도해주세요.'
    : error.message)
  return data
}
export const createRoom = (nickname, config) => rpc('zr_create_room', { p_nickname: nickname, p_config: config })
export const joinRoom = (code, nickname) => rpc('zr_join_room', { p_code: code, p_nickname: nickname })
export const readRoom = (id) => rpc('zr_read_room', { p_room: id })
export const startRoom = (id) => rpc('zr_start_room', { p_room: id })
export const leaveRoom = (id) => rpc('zr_leave_room', { p_room: id })
export const updateRoomStat = (roomId, distance, health, status) => rpc('zr_update_stat', {
  p_room: roomId, p_distance: distance, p_health: health, p_status: status,
})

