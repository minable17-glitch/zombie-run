// Dependency injection keeps credential-handling logic testable without live accounts.
export function makeAuthHandler({ admin, createAuthClient, redirects, rateLimit }) {
  const allowed = new Set(redirects)
  const origins = new Set(redirects.map(url => new URL(url).origin))
  return async function handle(request) {
    const origin = request.headers.get('origin')
    const headers = {
      'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin',
      ...(origin && origins.has(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    }
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers })
    if (origin && !origins.has(origin)) return reply({ error: '허용되지 않은 요청이에요.' }, 403)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (request.method !== 'POST') return reply({ error: '지원하지 않는 요청이에요.' }, 405)
    try {
      const reader = request.body?.getReader()
      if (!reader) return reply({ error: '입력 내용을 확인해주세요.' }, 400)
      let size = 0, text = ''
      const decoder = new TextDecoder()
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 4096) { await reader.cancel(); return reply({ error: '요청이 너무 길어요.' }, 413) }
        text += decoder.decode(value, { stream: true })
      }
      text += decoder.decode()
      let body
      try { body = JSON.parse(text) } catch { return reply({ error: '입력 내용을 확인해주세요.' }, 400) }
      const { action, password, redirectTo } = body ?? {}
      if (!['login', 'reset', 'recover'].includes(action) || !allowed.has(redirectTo))
        return reply({ error: '입력 내용을 확인해주세요.' }, 400)
      const identifier = action === 'recover' ? body.email : body.username
      if (typeof identifier !== 'string' || identifier.length > (action === 'recover' ? 254 : 20))
        return reply({ error: '입력 내용을 확인해주세요.' }, 400)
      const normalized = identifier.trim().toLowerCase()
      if (action !== 'recover' && !/^[a-z0-9_]{3,20}$/.test(normalized))
        return reply({ error: '아이디 또는 비밀번호를 확인해주세요.' }, 400)
      if (action === 'recover' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized))
        return reply({ error: '이메일을 확인해주세요.' }, 400)
      if (action === 'login' && (typeof password !== 'string' || !password || password.length > 256))
        return reply({ error: '아이디 또는 비밀번호를 확인해주세요.' }, 400)
      if (!await rateLimit(action, normalized, request))
        return reply({ error: '요청이 많아요. 잠시 후 다시 시도해주세요.' }, 429)
      const { data: profile, error: profileError } = await admin.from('profiles')
        .select('email').eq(action === 'recover' ? 'email' : 'username', normalized).maybeSingle()
      if (profileError) throw new Error('profile unavailable')
      const auth = createAuthClient().auth
      if (action === 'login') {
        // Auth validates the password. Never return the mapping or admin credentials.
        if (!profile) return reply({ error: '아이디 또는 비밀번호를 확인해주세요.' }, 401)
        const { data, error } = await auth.signInWithPassword({ email: profile.email, password })
        if (error || !data.session) return reply({ error: '아이디 또는 비밀번호를 확인해주세요.' }, 401)
        return reply({ session: { access_token: data.session.access_token, refresh_token: data.session.refresh_token } })
      }
      if (profile) {
        const { error } = action === 'reset'
          ? await auth.resetPasswordForEmail(profile.email, { redirectTo })
          : await auth.signInWithOtp({ email: profile.email, options: {
              shouldCreateUser: false, emailRedirectTo: redirectTo + '?account=1',
            } })
        // Recovery deliberately returns the same public response for unknown accounts
        // and provider failures, to avoid disclosing registration status.
        if (error) return reply({ ok: true })
      }
      return reply({ ok: true })
    } catch {
      return reply({ error: '계정 서비스를 사용할 수 없어요. 잠시 후 다시 시도해주세요.' }, 503)
    }
  }
}

