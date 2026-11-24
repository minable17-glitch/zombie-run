// 새로 배포했는데 폰에 예전 화면이 남는 문제(깃허브 페이지는 index.html 을 최대 10분 캐시) 막기:
// 처음 열 때와 다시 화면으로 돌아올 때 index.html 을 캐시 없이 받아 보고, 번들 이름이 바뀌었으면 새로 고친다.
// 달리는 중(.zr-game-shell 이 있음)에는 건드리지 않는다. 같은 번들로 두 번 새로 고치지 않게 sessionStorage 로 막는다.
const KEY = 'zr-reloaded-for'
const bundleOf = html => html.match(/assets\/index-[\w-]+\.js/)?.[0] ?? null

export async function checkForNewVersion({ doc = document, fetchImpl = fetch, base = '/', reload = () => location.reload(), storage = sessionStorage } = {}) {
  const current = bundleOf([...doc.scripts].map(s => s.getAttribute('src') || '').join(' '))
  if (!current || doc.querySelector('.zr-game-shell')) return false
  try {
    const res = await fetchImpl(`${base}index.html`, { cache: 'no-store' })
    if (!res.ok) return false
    const latest = bundleOf(await res.text())
    if (!latest || latest === current || storage.getItem(KEY) === latest) return false
    storage.setItem(KEY, latest)
    reload()
    return true
  } catch {
    return false
  }
}

export function watchForNewVersion(base) {
  const check = () => { void checkForNewVersion({ base }) }
  check()
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check() })
}
