// Short, rate-limited pulses. Unsupported devices retain the visual warning.
export function createProximityAlert(vibrate) {
  let lastAt = -Infinity
  let lastBand = 0
  let active = false
  const pulse = pattern => { try { return vibrate?.(pattern) } catch { return false } }
  return {
    stop() {
      if (active) pulse(0)
      active = false
      lastBand = 0
    },
    update(distance, now, enabled = true) {
      const band = enabled && Number.isFinite(distance) ? (distance <= 25 ? 2 : distance <= 70 ? 1 : 0) : 0
      if (!band) { this.stop(); return }
      const interval = band === 2 ? 3000 : 8000
      if (now - lastAt >= interval || band > lastBand) {
        pulse(band === 2 ? [180, 100, 180] : [100])
        active = true
        lastAt = now
      }
      lastBand = band
    },
  }
}
