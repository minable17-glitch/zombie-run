import { supabase } from './supabaseClient.js'
import { ensureRoomIdentity } from './roomApi.js'

async function call(name, args = {}) {
  const { data, error } = await supabase.rpc(name, args)
  if (error || data?.error) throw Error(data?.error || (error.code === 'PGRST202' ? '개인 기록 기능을 준비 중이에요. 잠시 후 다시 시도해주세요.' : error.message))
  return data
}
export async function currentRunner() { await ensureRoomIdentity(); return call('zr_runner_me') }
export const connectRunner = (nickname, code, create = false) => call('zr_runner_connect', { p_nickname:nickname, p_code:code, p_create:create })
export const disconnectRunner = () => call('zr_runner_disconnect')
export const changeRunnerCode = code => call('zr_runner_change_code', { p_code:code })
export const linkSchoolRunner = () => call('zr_runner_school_link')
const mode = config => config.mapId ? `map:${config.mapId}` : config.playMode || 'free'
export const startSolo = (id, config) => call('zr_solo_start', { p_id:id, p_mode:mode(config), p_pace:config.paceIdx, p_radius:config.mapId ? 0 : config.radiusIdx ?? 1, p_goal:config.missionGoalM || 0, p_goal_sec:config.missionGoalSec || 0, p_goal_pace_sec:config.missionGoalPaceSec || 0 })
export const updateSolo = (id, s) => call('zr_solo_update', { p_id:id, p_elapsed:Math.floor(s.elapsed), p_distance:s.distance, p_status:s.status, p_pace_reached_sec:s.paceReachedSec ?? null })
export const soloBoard = config => call('zr_solo_board', { p_mode:mode(config), p_pace:config.paceIdx, p_radius:config.mapId ? 0 : config.radiusIdx ?? 1, p_goal:config.missionGoalM || 0, p_goal_sec:config.missionGoalSec || 0, p_goal_pace_sec:config.missionGoalPaceSec || 0 })
