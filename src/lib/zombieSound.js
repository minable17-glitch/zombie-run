// 🧟 체험 판 좀비 접근 소리 — 팔을 흔드느라 화면을 못 볼 때 귀로 알게.
// (1) 좀비 울음소리: 가까울수록 크고 자주. public/sfx 의 CC0 녹음(출처는 public/sfx/CREDITS.md)을 Web Audio 로 틀고,
//     파일을 아직 못 받았거나 못 읽으면 합성 소리(톱니파 + 떨림 + 잡음)로 대신한다.
// (2) 거리 음성: 50·40·30·20·10m 를 새로 지날 때만 폰의 한국어 음성으로 읽는다. 멀어졌다 다시 오면 또 읽는다.
// 브라우저는 버튼을 누른 순간에만 소리를 켤 수 있어서, 체험 시작 버튼에서 unlock() 을 부른다.

export const CALLOUT_STEPS_M = [50, 40, 30, 20, 10]
const CALLOUT_RESET_M = 6 // 이만큼 다시 멀어져야 같은 거리를 또 읽는다
const SPEAK_GAP_MS = 1200

// 거리별 울음 간격(ms)·크기(0~1). 70m 밖이면 조용히
export function growlPlan(distanceM) {
  if (!Number.isFinite(distanceM) || distanceM > 70) return null
  const near = Math.min(1, Math.max(0, (70 - distanceM) / 62)) // 70m → 0, 8m → 1
  return {
    intervalMs: distanceM <= 15 ? 1300 : distanceM <= 30 ? 2000 : distanceM <= 50 ? 3000 : 4500, // 녹음이 1~1.5초라 너무 겹치지 않게
    volume: 0.15 + near * 0.85,
  }
}

export function calloutText(step) {
  return step <= 10 ? '10미터! 빨리!' : `좀비 ${step}미터`
}

// 거리 읽기 판단만 따로 — 소리 장치 없이 시험할 수 있게
export function createCalloutTracker() {
  const spoken = new Set()
  return function next(distanceM) {
    if (!Number.isFinite(distanceM)) { spoken.clear(); return null }
    for (const step of CALLOUT_STEPS_M) if (spoken.has(step) && distanceM > step + CALLOUT_RESET_M) spoken.delete(step)
    // 지금 거리 이하인 가장 가까운(작은) 단계 하나만 — 한 번에 여러 단계를 건너뛰어도 한 번만 읽는다
    const due = CALLOUT_STEPS_M.filter(step => distanceM <= step && !spoken.has(step))
    if (!due.length) return null
    due.forEach(step => spoken.add(step))
    return Math.min(...due)
  }
}

export const GROWL_FILES = ['growl1.mp3', 'growl2.mp3', 'growl3.mp3', 'growl4.mp3']
export const ATTACK_FILE = 'attack.mp3'

export function createZombieAudio({
  AudioContextImpl = globalThis.AudioContext || globalThis.webkitAudioContext,
  speech = globalThis.speechSynthesis,
  Utterance = globalThis.SpeechSynthesisUtterance,
  baseUrl = (import.meta.env?.BASE_URL ?? '/') + 'sfx/',
  fetchImpl = globalThis.fetch,
} = {}) {
  let ctx = null
  let growls = [] // 받아 둔 울음소리 AudioBuffer
  let attack = null
  let loading = null
  let lastGrowlIdx = -1
  let lastGrowlAt = -Infinity
  let lastSpeakAt = -Infinity
  let callouts = createCalloutTracker()

  const say = (text, now = Date.now(), force = false) => {
    if (!speech || !Utterance) return false
    if (!force && now - lastSpeakAt < SPEAK_GAP_MS) return false
    try {
      speech.cancel()
      const u = new Utterance(text)
      u.lang = 'ko-KR'
      u.rate = 1.15
      u.volume = 1
      speech.speak(u)
      lastSpeakAt = now
      return true
    } catch { return false }
  }

  const load = () => {
    if (loading || !ctx || !fetchImpl) return
    const get = name => fetchImpl(baseUrl + name).then(r => r.arrayBuffer())
      .then(data => new Promise((resolve, reject) => ctx.decodeAudioData(data, resolve, reject))).catch(() => null)
    loading = Promise.all([Promise.all(GROWL_FILES.map(get)), get(ATTACK_FILE)]).then(([g, a]) => {
      growls = g.filter(Boolean)
      attack = a
    })
  }

  const playBuffer = (buffer, volume) => {
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.playbackRate.value = 0.92 + Math.random() * 0.16 // 매번 조금 다른 목소리
    const gain = ctx.createGain()
    gain.gain.value = volume
    src.connect(gain).connect(ctx.destination)
    src.start()
  }

  const growl = (volume, long = false) => {
    if (!ctx) return
    try {
      if (long && attack) return playBuffer(attack, volume)
      if (growls.length) {
        // 같은 소리가 연달아 나오지 않게
        let i = Math.floor(Math.random() * growls.length)
        if (growls.length > 1 && i === lastGrowlIdx) i = (i + 1) % growls.length
        lastGrowlIdx = i
        return playBuffer(growls[i], volume)
      }
    } catch { /* 파일 재생이 안 되면 아래 합성 소리로 */ }
    try {
      const t = ctx.currentTime
      const dur = long ? 1.4 : 0.85
      const out = ctx.createGain()
      out.gain.setValueAtTime(0.0001, t)
      out.gain.exponentialRampToValueAtTime(Math.max(0.001, volume * 0.6), t + 0.08)
      out.gain.exponentialRampToValueAtTime(0.0001, t + dur)
      const lowpass = ctx.createBiquadFilter()
      lowpass.type = 'lowpass'
      lowpass.frequency.value = 650
      lowpass.connect(out)
      out.connect(ctx.destination)
      // 낮은 톱니파가 천천히 내려가며 떨리면 "으어어"처럼 들린다
      const voice = ctx.createOscillator()
      voice.type = 'sawtooth'
      const base = 75 + Math.random() * 30
      voice.frequency.setValueAtTime(base * 1.25, t)
      voice.frequency.exponentialRampToValueAtTime(base, t + dur)
      const wobble = ctx.createOscillator()
      wobble.frequency.value = 14 + Math.random() * 8
      const wobbleDepth = ctx.createGain()
      wobbleDepth.gain.value = 18
      wobble.connect(wobbleDepth).connect(voice.frequency)
      voice.connect(lowpass)
      // 목 긁는 잡음
      const noise = ctx.createBufferSource()
      const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate)
      const data = buffer.getChannelData(0)
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
      noise.buffer = buffer
      const rasp = ctx.createBiquadFilter()
      rasp.type = 'bandpass'
      rasp.frequency.value = 380
      const raspGain = ctx.createGain()
      raspGain.gain.value = 0.35
      noise.connect(rasp).connect(raspGain).connect(lowpass)
      for (const node of [voice, wobble, noise]) { node.start(t); node.stop(t + dur + 0.05) }
    } catch { /* 소리가 안 나도 게임은 계속 */ }
  }

  return {
    // 시작 버튼 누른 그 순간에 불러야 소리가 켜진다
    unlock() {
      try {
        if (!ctx && AudioContextImpl) ctx = new AudioContextImpl()
        void ctx?.resume?.()
        load()
      } catch { ctx = null }
      try { speech?.cancel?.(); if (Utterance) speech?.speak?.(Object.assign(new Utterance(''), { volume: 0 })) } catch { /* ignore */ }
    },
    reset() {
      callouts = createCalloutTracker()
      lastGrowlAt = -Infinity
      lastSpeakAt = -Infinity
    },
    // 매초 부른다. 반환값: 이번에 읽은 거리(테스트용)
    update(distanceM, now, enabled = true) {
      if (!enabled) { callouts(Infinity); return null }
      const plan = growlPlan(distanceM)
      if (plan && now - lastGrowlAt >= plan.intervalMs) { growl(plan.volume); lastGrowlAt = now }
      const step = callouts(distanceM)
      if (step != null && say(calloutText(step), now, step <= 10)) return step
      return null
    },
    hit(now = Date.now()) { growl(1, true); say('잡혔다! 생명 하나 줄었어요', now, true) },
    say: (text, now) => say(text, now, true),
    stop() { try { speech?.cancel?.() } catch { /* ignore */ } },
  }
}
