// Capture intent before the auth SDK consumes and removes callback URL fields.
const url = new URL(window.location.href)
const hashParams = new URLSearchParams(url.hash.slice(1))
export const accountLanding = url.searchParams.has('account') ||
  hashParams.get('type') === 'magiclink'

// Supabase recovery links are single-use. Capture an expired-link callback before
// the auth SDK clears the hash so the account screen can explain how to recover.
export const passwordRecoveryExpired = hashParams.get('error_code') === 'otp_expired'
