// Capture intent before the auth SDK consumes and removes callback URL fields.
const url = new URL(window.location.href)
export const accountLanding = url.searchParams.has('account') ||
  new URLSearchParams(url.hash.slice(1)).get('type') === 'magiclink'
