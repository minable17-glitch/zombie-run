import { supabase } from './supabaseClient.js'

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
    return data.map(rowToZombieMap)
  } catch {
    return []
  }
}
