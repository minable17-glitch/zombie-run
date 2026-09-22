import { supabase } from './supabaseClient.js'
import { ensureRoomIdentity } from './roomApi.js'

async function call(name, args = {}) {
  const { data, error } = await supabase.rpc(name, args)
  if (error || data?.error) throw Error(data?.error || (error.code === 'PGRST202' ? '개인 기록 기능을 준비 중이에요. 잠시 후 다시 시도해주세요.' : error.message))
  return data
}
export async function currentRunner() { await ensureRoomIdentity(); return call('zr_runner_me') }
export const connectRunner = (nickname, code = null) => call('zr_runner_connect', { p_nickname:nickname, p_code:code })
export const disconnectRunner = () => call('zr_runner_disconnect')
export const startSolo = (id, config) => call('zr_solo_start', { p_id:id, p_mode:config.playMode || 'free', p_pace:config.paceIdx, p_radius:config.radiusIdx ?? 1 })
export const updateSolo = (id, s) => call('zr_solo_update', { p_id:id, p_elapsed:Math.floor(s.elapsed), p_distance:s.distance, p_status:s.status })
export const soloBoard = config => call('zr_solo_board', { p_mode:config.playMode || 'free', p_pace:config.paceIdx, p_radius:config.radiusIdx ?? 1 })
