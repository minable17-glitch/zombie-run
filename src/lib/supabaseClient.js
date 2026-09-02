import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// 키가 아직 설정 안 됐으면 null — 관리자 지도 저장/불러오기 기능만 조용히 꺼지고
// (자유 모드로) 게임 자체는 그대로 동작함
export const supabase = url && anonKey ? createClient(url, anonKey) : null
