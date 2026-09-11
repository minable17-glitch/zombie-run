import { supabase } from './supabaseClient.js'

export function normalizeUsername(username) {
  return username.trim().toLowerCase()
}

export function siteUrl() {
  return window.location.origin + import.meta.env.BASE_URL
}

// Email mappings stay on the server. No anonymous profiles SELECT.
export async function authRequest(action, fields) {
  if (!supabase) throw new Error('계정 연결 설정이 필요해요.')
  const { data, error } = await supabase.functions.invoke('zombie-auth', {
    body: { action, ...fields, redirectTo: siteUrl() },
  })
  if (error) {
    let message = '계정 서비스에 연결하지 못했어요. 잠시 후 다시 시도해주세요.'
    try {
      const body = await error.context?.json()
      if (typeof body?.error === 'string') message = body.error
    } catch { /* retain useful fallback */ }
    throw new Error(message)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

export async function loginWithUsername(username, password) {
  const result = await authRequest('login', { username: normalizeUsername(username), password })
  const { error } = await supabase.auth.setSession(result.session)
  if (error) throw error
}

export async function ensureOwnProfile() {
  const { error } = await supabase.rpc('zr_ensure_profile')
  if (error) throw new Error('계정 정보를 준비하지 못했어요. 다시 시도해주세요.')
}
