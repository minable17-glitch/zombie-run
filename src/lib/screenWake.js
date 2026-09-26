// A screen lock prevents automatic sleep only while the page is visible.
export function createScreenWake(onStatus, nav = navigator, doc = document) {
  let wanted = false, disposed = false, lock = null, generation = 0
  const release = () => {
    generation++
    const old = lock
    lock = null
    if (old) void old.release().catch(() => {})
  }
  const acquire = async () => {
    if (disposed || !wanted || doc.hidden || lock) return
    const request = ++generation
    onStatus('requesting')
    try {
      const next = await nav.wakeLock.request('screen')
      if (disposed || !wanted || doc.hidden || request !== generation) {
        await next.release()
        return
      }
      lock = next
      onStatus('on')
      next.addEventListener('release', () => {
        if (lock !== next) return
        lock = null
        if (!disposed) onStatus(wanted ? 'released' : 'off')
      }, { once: true })
    } catch {
      if (!disposed && request === generation) onStatus('unavailable')
    }
  }
  const visibility = () => {
    if (doc.hidden) { release(); if (wanted) onStatus('released') }
    else void acquire()
  }
  doc.addEventListener('visibilitychange', visibility)
  return {
    setEnabled(enabled) {
      wanted = enabled
      if (!nav.wakeLock?.request) { onStatus('unsupported'); return }
      if (enabled) void acquire()
      else { release(); onStatus('off') }
    },
    dispose() { disposed = true; release(); doc.removeEventListener('visibilitychange', visibility) },
  }
}
