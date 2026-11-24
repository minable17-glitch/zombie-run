import { test, expect, vi } from 'vitest'
import { checkForNewVersion } from '../src/lib/autoUpdate.js'

const docWith = (src, running = false) => ({
  scripts: [{ getAttribute: () => src }],
  querySelector: () => (running ? {} : null),
})
const store = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) } }
const serve = html => vi.fn(async () => ({ ok: true, text: async () => html }))

test('reloads once when a newer bundle is deployed', async () => {
  const reload = vi.fn(); const storage = store()
  const fetchImpl = serve('<script src="/zombie-run/assets/index-NEW1.js"></script>')
  const doc = docWith('/zombie-run/assets/index-OLD1.js')
  expect(await checkForNewVersion({ doc, fetchImpl, reload, storage, base: '/zombie-run/' })).toBe(true)
  expect(fetchImpl).toHaveBeenCalledWith('/zombie-run/index.html', { cache: 'no-store' })
  expect(await checkForNewVersion({ doc, fetchImpl, reload, storage })).toBe(false) // no reload loop
  expect(reload).toHaveBeenCalledTimes(1)
})

test('does nothing when up to date, mid-run, or offline', async () => {
  const reload = vi.fn()
  expect(await checkForNewVersion({ doc: docWith('/assets/index-A.js'), fetchImpl: serve('assets/index-A.js'), reload, storage: store() })).toBe(false)
  expect(await checkForNewVersion({ doc: docWith('/assets/index-A.js', true), fetchImpl: serve('assets/index-B.js'), reload, storage: store() })).toBe(false)
  expect(await checkForNewVersion({ doc: docWith('/assets/index-A.js'), fetchImpl: async () => { throw Error('offline') }, reload, storage: store() })).toBe(false)
  expect(reload).not.toHaveBeenCalled()
})
