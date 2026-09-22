// Vibration amplitude is device-controlled; duration and cadence convey urgency.
const levels = [null,
  { interval: 8000, pattern: [100] },
  { interval: 4000, pattern: [140, 160, 140] },
  { interval: 2000, pattern: [200, 100, 200] },
  { interval: 1000, pattern: [250, 80, 250, 80, 250] },
]
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
      const band = enabled && Number.isFinite(distance) ? (distance <= 15 ? 4 : distance <= 30 ? 3 : distance <= 50 ? 2 : distance <= 70 ? 1 : 0) : 0
      if (!band) { this.stop(); return }
      const { interval, pattern } = levels[band]
      if (now - lastAt >= interval || band > lastBand) {
        pulse(pattern)
        active = true
        lastAt = now
      }
      lastBand = band
    },
  }
}
