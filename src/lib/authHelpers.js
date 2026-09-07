import { supabase } from './supabaseClient.js'

// 아이디(username)으로 로그인하려면 Supabase Auth가 원래 필요로 하는 이메일을
// 먼저 찾아야 해서, profiles 테이블에서 매핑을 조회함
export async function lookupEmailByUsername(username) {
  const { data, error } = await supabase
    .from('profiles')
    .select('email')
    .eq('username', username.trim())
    .maybeSingle()
  if (error) throw error
  return data?.email ?? null
}

export async function isUsernameTaken(username) {
  const { data, error } = await supabase
    .from('profiles')
    .select('username')
    .eq('username', username.trim())
    .maybeSingle()
  if (error) throw error
  return !!data
}

// 배포 환경(GitHub Pages 하위 경로)과 로컬 개발 둘 다에서 올바른 절대 URL을 만들어줌.
// 비밀번호 재설정 메일의 링크가 이 주소로 돌아오게 됨 (Supabase 대시보드
// Authentication → URL Configuration에 이 주소가 허용 목록에 등록돼 있어야 함)
export function siteUrl() {
  return window.location.origin + import.meta.env.BASE_URL
}
