// 게임 화면(App.jsx)과 방(RoomLobby.jsx) 양쪽에서 같이 쓰는 설정값들.
// 방 모드에서는 방장이 고른 값을 방 설정(config)에 그대로 저장해서 참가자 전원이 공유함.

// 좀비 속도 = 선택한 목표 페이스(분:초/km)를 그대로 m/s로 환산한 값
export const PACE_PRESETS = [
  { label: "5'30\"/km", secPerKm: 5 * 60 + 30 },
  { label: "6'00\"/km", secPerKm: 6 * 60 },
  { label: "6'30\"/km", secPerKm: 6 * 60 + 30 },
  { label: "7'00\"/km", secPerKm: 7 * 60 },
].map((p) => ({ ...p, mps: 1000 / p.secPerKm }))
export const DEFAULT_PACE_IDX = 1

// 제한구역 모드: 시작 위치를 중심으로 반경을 정해서 그 안에서만 좀비/아이템이 등장
export const AREA_RADIUS_PRESETS = [300, 500, 1000, 2000] // 미터
export const DEFAULT_RADIUS_IDX = 1

// 거리 목표런: 목표 거리에 도달하면 성공 — 생존 랭킹과는 별도로, 도달까지 걸린 시간으로 순위를 매김
export const GOAL_DISTANCE_PRESETS = [1000, 3000, 5000, 10000] // 미터
export const DEFAULT_GOAL_IDX = 1
export const MIN_GOAL_DISTANCE_KM = 0.1
export const MAX_GOAL_DISTANCE_KM = 50 // 서버 쪽 goal_m 상한(50000m)과 맞춤

// 시간 목표런: 목표 시간 동안 달리면 성공 — 그 시간 동안 달린 거리로 순위를 매김
export const GOAL_TIME_PRESETS = [300, 600, 1200, 1800] // 초 (5/10/20/30분)
export const DEFAULT_TIME_IDX = 1
export const MIN_GOAL_TIME_MIN = 1
export const MAX_GOAL_TIME_MIN = 120 // 서버 쪽 goal_sec 상한(7200초)과 맞춤
