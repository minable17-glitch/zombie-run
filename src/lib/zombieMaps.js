import { supabase } from './supabaseClient.js'
import { validZombieMap } from './gameSafety.js'

export const LEGACY_UNNAMED_MAP = '이름 없는 지도'

export function normalizeMapName(name) {
  return typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : ''
}

export function mapNameError(name, savedMaps = [], editingMapId = null) {
  const normalized = normalizeMapName(name)
  if (!normalized) return '지도 이름을 입력해주세요.'
  if (normalized === LEGACY_UNNAMED_MAP) return '구분할 수 있는 지도 이름을 입력해주세요.'
  if (savedMaps.some(map => map.id !== editingMapId &&
      normalizeMapName(map.name).toLocaleLowerCase('ko-KR') === normalized.toLocaleLowerCase('ko-KR')))
    return '같은 이름의 지도가 이미 있어요. 다른 이름을 입력해주세요.'
  return ''
}

export function selectableZombieMap(row) {
  return validZombieMap(row) && !mapNameError(row.name) && row.routes.length > 0
}

export function rowToZombieMap(row) {
  return {
    id: row.id,
    name: row.name,
    center: { lat: row.center_lat, lon: row.center_lon },
    radius: row.radius_m,
    routes: row.routes,
  }
}

// 관리자가 저장해둔 좀비 지도 목록을 가져옴. Supabase 연결이 없거나 네트워크 문제가 있으면
// 빈 배열을 돌려주고, 호출부는 그냥 자유/제한구역 모드로 계속 진행하면 됨.
export async function fetchZombieMaps() {
  if (!supabase) return []
  try {
    const { data, error } = await supabase.from('zombie_maps').select('*').order('created_at', { ascending: false })
    if (error || !data) return []
    // Legacy placeholder/empty maps remain visible to their owner in the editor
    // so they can be renamed or deleted, but never clutter game selection lists.
    return data.filter(selectableZombieMap).map(rowToZombieMap)
  } catch {
    return []
  }
}
