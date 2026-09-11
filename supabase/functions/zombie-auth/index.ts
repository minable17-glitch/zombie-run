import { createClient } from 'npm:@supabase/supabase-js@2.112.4'
import { makeAuthHandler } from './handler.js'

const url = Deno.env.get('SUPABASE_URL')!
const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const anon = Deno.env.get('SUPABASE_ANON_KEY')!
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
const admin = createClient(url, secret, options)
const redirects = (Deno.env.get('ZR_ALLOWED_REDIRECTS') ||
  'https://minable17-glitch.github.io/zombie-run/,https://localhost:5173/').split(',').map(s => s.trim())

async function limited(key: string, limit: number) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret + ':' + key))
  const digest = Array.from(new Uint8Array(bytes)).map(b => b.toString(16).padStart(2, '0')).join('')
  const { data, error } = await admin.rpc('zr_auth_limit', { p_key: digest, p_limit: limit })
  if (error) throw error // fail closed when the limiter is unavailable
  return data === true
}

Deno.serve(makeAuthHandler({
  admin, redirects, createAuthClient: () => createClient(url, anon, options),
  rateLimit: async (action: string, identifier: string, request: Request) => {
    const ip = request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() || 'unknown'
    return await limited('ip:' + ip, 60) &&
      await limited(action + ':' + identifier, action === 'login' ? 10 : 3)
  },
}))

