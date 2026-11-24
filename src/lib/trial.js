// 🧪 로그인 없는 좀비런 체험 — 발표·연수에서 듣는 사람이 바로 해 보게 하려는 짧은 생존 판.
// 기록은 어디에도 저장하지 않는다. 실외는 실제 GPS, 실내는 휴대폰 흔들기(제자리 뛰기)로 가상 위치를 움직인다.
import { destinationPoint, advanceAlongPath, bearingTo, haversineDistance } from './geo.js'
import { fetchWalkingPath } from './routing.js'

export const TRIAL_DURATIONS_SEC = [30, 60, 120]
export const DEFAULT_TRIAL_SEC = 60
export const TRIAL_PACE_IDX = 3 // 7'00"/km — 처음 해 보는 사람도 따돌릴 수 있게 가장 느린 좀비
export const TRIAL_STRIDE_M = 1 // 흔들기 한 번 = 이만큼 앞으로 (초당 3번쯤 흔들면 좀비보다 조금 빠름)
const TRIAL_HEADING_DEG = 0
// 실내 체험은 서울광장 앞에서 세종대로를 따라 광화문 쪽으로 달린다 — 가상 위치가 건물을 뚫고 가지 않게 실제 길 위로.
// 시작할 때 도보 경로(ORS)를 한 번 받아 쓰고, 못 받으면 세종대로를 대충 따라가는 이 점들로 대신한다.
export const TRIAL_INDOOR_START = { lat: 37.5662, lon: 126.9771 }
export const TRIAL_INDOOR_DEST = { lat: 37.5755, lon: 126.9769 }
export const TRIAL_INDOOR_FALLBACK_ROUTE = [TRIAL_INDOOR_START, { lat: 37.5688, lon: 126.9772 }, { lat: 37.5712, lon: 126.9769 }, TRIAL_INDOOR_DEST]
export async function loadIndoorRoute(apiKey) {
  const path = await fetchWalkingPath(apiKey, TRIAL_INDOOR_START, TRIAL_INDOOR_DEST)
  return path && path.length > 1 ? path : TRIAL_INDOOR_FALLBACK_ROUTE
}

// 1분 안에 좀비를 만나고 따돌려 봐야 하니 일찍·가까이 등장시키고, 생명도 줄인다
export const TRIAL_GAME = {
  health: 3,
  maxHealth: 3,
  nextWaveSec: 3,
  waveGapSec: 20,
  spawnRangeM: [35, 60],
  respawnRangeM: [40, 70],
}

export const TRIAL_NAME_MAX = 10
const NAME_KEY = 'zr-trial-name'
// 같은 기기로 다시 할 때 이름을 또 안 치게 — 저장이 막힌 브라우저면 그냥 빈칸
export function loadTrialName() {
  try { return globalThis.localStorage?.getItem(NAME_KEY) || '' } catch { return '' }
}
export function saveTrialName(name) {
  try { globalThis.localStorage?.setItem(NAME_KEY, name) } catch { /* 저장 못 해도 체험은 된다 */ }
}

// 주소에 ?try=1 (또는 ?try) 를 붙이면 체험 화면으로 바로 연다 — QR 코드로 나눠 주기 좋게
export function isTrialEntry(locationLike = globalThis.location) {
  if (!locationLike) return false
  return new URLSearchParams(locationLike.search || '').has('try')
}

// 흔들기 = 걸음. 중력을 뺀 가속도 크기가 위로 크게 튀었다가(peak) 다시 잠잠해져야(re-arm) 한 걸음으로 친다.
// 너무 촘촘한 신호는 손떨림·되튐이라 MIN_GAP_MS 안에선 안 센다.
const MIN_GAP_MS = 220
// relativeRearm 이 있으면 마지막 꼭대기의 그 비율 아래로만 내려와도 다시 셀 준비를 한다 —
// 팔을 계속 흔들면 값이 rearm 까지 안 떨어지는 폰이 있어서(갤럭시에서 0걸음).
export function createStepDetector({ peak = 4, rearm = 2, minGapMs = MIN_GAP_MS, relativeRearm = 0 } = {}) {
  let armed = true
  let lastStepAt = -Infinity
  let top = 0
  return function feed(value, t) {
    if (!Number.isFinite(value)) return false
    if (!armed) top = Math.max(top, value)
    if (armed && value >= peak && t - lastStepAt >= minGapMs) {
      armed = false
      lastStepAt = t
      top = value
      return true
    }
    if (value <= Math.max(rearm, top * relativeRearm)) armed = true
    return false
  }
}

// 팔 흔들기: 휴대폰을 쥐고 달리듯 팔을 앞뒤로 흔들면 손목이 빠르게 돌았다 멈췄다 한다.
// 자이로(회전 속도, 도/초)가 있으면 그것으로 — 앞으로 한 번, 뒤로 한 번이 각각 한 걸음(달릴 때 팔 한 번 = 발 한 번).
// 자이로가 없는 기기는 가속도로 대신하되, 처음 흔들기보다 문턱을 낮춘다(팔 흔들기는 위아래 흔들기보다 덜 튄다).
export const SWING_GYRO = { peak: 60, rearm: 30, minGapMs: 0, relativeRearm: 0.5 }
export const SWING_ACCEL = { peak: 2.5, rearm: 1.2, minGapMs: 0, relativeRearm: 0.5 }
const SWING_MIN_GAP_MS = 230 // 회전·가속 어느 쪽이 잡든 걸음 사이 최소 간격 (초당 4번 넘게는 안 셈)

function rotationMagnitude(event) {
  const r = event.rotationRate
  if (r && [r.alpha, r.beta, r.gamma].every(Number.isFinite)) return Math.hypot(r.alpha, r.beta, r.gamma)
  return NaN
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

// 탭(또는 팔 흔들기)으로 움직이는 가상 위치. motion 이 false 면 탭만, true 면 팔 흔들기도 걸음으로 센다(탭은 언제나 된다).
// route 가 있으면 그 길을 따라 움직이고, 길이 끝나면 마지막 방향으로 계속 간다.
export function createShakeRunner(start, { stride = TRIAL_STRIDE_M, onStep, motion = true, route = null } = {}) {
  const path = route && route.length > 1 ? route : null
  const pathLength = path ? path.slice(1).reduce((sum, p, i) => sum + haversineDistance(path[i].lat, path[i].lon, p.lat, p.lon), 0) : 0
  const pointAt = meters => {
    if (!path) return meters > 0 ? destinationPoint(start.lat, start.lon, meters, TRIAL_HEADING_DEG) : start
    if (meters <= pathLength) return advanceAlongPath(path, meters).pos
    const a = path[path.length - 2], b = path[path.length - 1]
    return destinationPoint(b.lat, b.lon, meters - pathLength, bearingTo(a.lat, a.lon, b.lat, b.lon))
  }
  let meters = 0
  let steps = 0
  let sensed = false
  let swings = 0
  let lastSwingAt = -Infinity
  // 최근 2초 동안 들어온 센서 값의 최댓값 — 화면에 띄워 폰마다 감도를 맞출 때 쓴다
  let recent = { rot: 0, acc: 0, at: 0 }
  const reading = { rot: 0, acc: 0, rate: 0 }
  let events = 0
  let rateFrom = null
  const gyro = createStepDetector(SWING_GYRO)
  const accel = createStepDetector(SWING_ACCEL)
  const step = () => {
    meters += stride
    steps += 1
    onStep?.(steps)
  }
  // 회전(자이로)과 가속 둘 다 본다 — 어느 쪽이든 한 번 크게 튀면 한 걸음
  const onMotion = event => {
    const t = Date.now()
    const r = rotationMagnitude(event)
    const a = motionMagnitude(event)
    if (Number.isFinite(r) || Number.isFinite(a)) sensed = true
    events += 1
    rateFrom ??= t
    if (t - recent.at > 2000) {
      Object.assign(reading, { rot: recent.rot, acc: recent.acc, rate: t > rateFrom ? Math.round(events * 1000 / (t - rateFrom)) : 0 })
      recent = { rot: 0, acc: 0, at: t }
      events = 0
      rateFrom = t
    }
    if (Number.isFinite(r)) recent.rot = Math.max(recent.rot, r)
    if (Number.isFinite(a)) recent.acc = Math.max(recent.acc, a)
    const hitGyro = gyro(r, t)
    const hitAccel = accel(a, t)
    if ((hitGyro || hitAccel) && t - lastSwingAt >= SWING_MIN_GAP_MS) { lastSwingAt = t; swings += 1; step() }
  }
  if (motion) globalThis.addEventListener?.('devicemotion', onMotion)
  return {
    step,
    get steps() { return steps },
    get sensed() { return sensed },
    get swings() { return swings },
    get reading() { return { ...reading } }, // 최근 2초 최대 회전(도/초)·가속(m/s²)·초당 신호 수
    // 지금까지 간 거리만큼 시작점에서 한 방향으로 옮긴 위치 — GPS 위치와 같은 모양으로
    position(now = Date.now()) {
      const p = pointAt(meters)
      return { timestamp: now, coords: { latitude: p.lat, longitude: p.lon, accuracy: 5 } }
    },
    stop() { globalThis.removeEventListener?.('devicemotion', onMotion) },
  }
}
