// 🧪 로그인 없는 좀비런 체험 — 발표·연수에서 듣는 사람이 바로 해 보게 하려는 짧은 생존 판.
// 기록은 어디에도 저장하지 않는다. 실외는 실제 GPS, 실내는 휴대폰 흔들기(제자리 뛰기)로 가상 위치를 움직인다.
import { destinationPoint } from './geo.js'

export const TRIAL_DURATIONS_SEC = [30, 60, 120]
export const DEFAULT_TRIAL_SEC = 60
export const TRIAL_PACE_IDX = 3 // 7'00"/km — 처음 해 보는 사람도 따돌릴 수 있게 가장 느린 좀비
export const TRIAL_STRIDE_M = 1 // 흔들기 한 번 = 이만큼 앞으로 (초당 3번쯤 흔들면 좀비보다 조금 빠름)
const TRIAL_HEADING_DEG = 45

// 1분 안에 좀비를 만나고 따돌려 봐야 하니 일찍·가까이 등장시키고, 생명도 줄인다
export const TRIAL_GAME = {
  health: 3,
  maxHealth: 3,
  nextWaveSec: 3,
  waveGapSec: 20,
  spawnRangeM: [35, 60],
  respawnRangeM: [40, 70],
}

// 주소에 ?try=1 (또는 ?try) 를 붙이면 체험 화면으로 바로 연다 — QR 코드로 나눠 주기 좋게
export function isTrialEntry(locationLike = globalThis.location) {
  if (!locationLike) return false
  return new URLSearchParams(locationLike.search || '').has('try')
}

// 흔들기 = 걸음. 중력을 뺀 가속도 크기가 위로 크게 튀었다가(peak) 다시 잠잠해져야(re-arm) 한 걸음으로 친다.
// 너무 촘촘한 신호는 손떨림·되튐이라 MIN_GAP_MS 안에선 안 센다.
const PEAK_MPS2 = 4
const REARM_MPS2 = 2
const MIN_GAP_MS = 220
export function createStepDetector() {
  let armed = true
  let lastStepAt = -Infinity
  return function feed(accelMagnitude, t) {
    if (!Number.isFinite(accelMagnitude)) return false
    if (armed && accelMagnitude >= PEAK_MPS2 && t - lastStepAt >= MIN_GAP_MS) {
      armed = false
      lastStepAt = t
      return true
    }
    if (accelMagnitude <= REARM_MPS2) armed = true
    return false
  }
}

function motionMagnitude(event) {
  const a = event.acceleration
  if (a && [a.x, a.y, a.z].every(Number.isFinite)) return Math.hypot(a.x, a.y, a.z)
  const g = event.accelerationIncludingGravity
  if (g && [g.x, g.y, g.z].every(Number.isFinite)) return Math.abs(Math.hypot(g.x, g.y, g.z) - 9.81)
  return NaN
}

// 아이폰(iOS 13+)은 버튼을 누른 그 순간에 허락을 받아야 흔들림을 읽을 수 있다
export async function requestMotionPermission() {
  const Motion = globalThis.DeviceMotionEvent
  if (typeof Motion?.requestPermission !== 'function') return true
  try {
    return (await Motion.requestPermission()) === 'granted'
  } catch {
    return false
  }
}

// 흔들기로 움직이는 가상 위치. step()은 흔들림이 안 잡히는 기기에서 화면 탭으로도 부른다.
export function createShakeRunner(start, { stride = TRIAL_STRIDE_M, onStep } = {}) {
  let meters = 0
  let steps = 0
  let sensed = false
  const detect = createStepDetector()
  const step = () => {
    meters += stride
    steps += 1
    onStep?.(steps)
  }
  const onMotion = event => {
    const m = motionMagnitude(event)
    if (Number.isFinite(m)) sensed = true
    if (detect(m, event.timeStamp ?? Date.now())) step()
  }
  globalThis.addEventListener?.('devicemotion', onMotion)
  return {
    step,
    get steps() { return steps },
    get sensed() { return sensed },
    // 지금까지 간 거리만큼 시작점에서 한 방향으로 옮긴 위치 — GPS 위치와 같은 모양으로
    position(now = Date.now()) {
      const p = meters > 0 ? destinationPoint(start.lat, start.lon, meters, TRIAL_HEADING_DEG) : start
      return { timestamp: now, coords: { latitude: p.lat, longitude: p.lon, accuracy: 5 } }
    },
    stop() { globalThis.removeEventListener?.('devicemotion', onMotion) },
  }
}
