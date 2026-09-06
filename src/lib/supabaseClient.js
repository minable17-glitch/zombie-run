import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// 키가 아직 설정 안 됐으면 null — 관리자 지도 저장/불러오기 기능만 조용히 꺼지고
// (자유 모드로) 게임 자체는 그대로 동작함
export const supabase = url && anonKey ? createClient(url, anonKey) : null

// 지금 연결된 Supabase 프로젝트 ID (예: "ikljkokebcqaxpctcjpy"). 계정에 프로젝트가
// 여러 개 있을 때 "SQL을 엉뚱한 프로젝트에 실행했다" 같은 혼란을 막기 위해 관리자
// 화면에 표시해줌
export const supabaseProjectRef = (() => {
  try {
    return new URL(url).hostname.split('.')[0]
  } catch {
    return null
  }
})()
