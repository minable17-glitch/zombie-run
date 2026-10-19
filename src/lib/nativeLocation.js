// Capacitor로 감싼 안드로이드 앱(APK)에서는 화면이 꺼지거나 다른 앱으로 전환해도 위치를
// 계속 받기 위해 @capacitor-community/background-geolocation을 쓴다. 일반 브라우저(웹)에서는
// 그대로 navigator.geolocation을 쓴다. App.jsx는 둘 중 뭐가 쓰이는지 몰라도 되도록, 브라우저의
// GeolocationPosition과 같은 모양({coords:{latitude,longitude,accuracy}, timestamp})으로 통일해서 넘긴다.
import { registerPlugin } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'

let plugin = null
function backgroundGeolocation() {
  if (!plugin) plugin = registerPlugin('BackgroundGeolocation')
  return plugin
}

// 안드로이드 13+에서는 "화면 꺼도 추적 중" 알림을 띄우려면 이 런타임 권한이 따로 필요하다.
// 거부돼도 백그라운드 추적 자체는 계속 시도하되, 사용자에게 보이는 알림만 안 뜰 수 있다.
let notificationsRequested = false
function ensureNotificationPermission() {
  if (notificationsRequested) return
  notificationsRequested = true
  LocalNotifications.checkPermissions()
    .then(status => status.display === 'granted' ? null : LocalNotifications.requestPermissions())
    .catch(() => {})
}

export function isNative() {
  return Boolean(window.Capacitor?.isNativePlatform?.())
}

function toPosition(location) {
  return {
    coords: { latitude: location.latitude, longitude: location.longitude, accuracy: location.accuracy },
    timestamp: location.time,
  }
}

// navigator.geolocation.watchPosition과 같은 모양: id(또는 핸들)를 반환하고, clearWatch(id)로 멈춘다.
export function watchPosition(onPosition, onError) {
  if (!isNative()) {
    return navigator.geolocation.watchPosition(onPosition, onError, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 })
  }
  ensureNotificationPermission()
  const bg = backgroundGeolocation()
  const handle = { id: null, stopped: false }
  bg.addWatcher({
    backgroundTitle: '좀비런 진행 중',
    backgroundMessage: '화면을 꺼도 위치 추적과 좀비 추격이 계속돼요. 취소하면 추적이 멈춰요.',
    requestPermissions: true,
    stale: false,
    distanceFilter: 0,
  }, (location, error) => {
    if (handle.stopped) return
    if (error) { onError?.(error); return }
    if (location) onPosition(toPosition(location))
  }).then(id => {
    handle.id = id
    if (handle.stopped) bg.removeWatcher({ id })
  })
  return handle
}

export function clearWatch(handle) {
  if (handle && typeof handle === 'object') {
    handle.stopped = true
    if (handle.id != null) backgroundGeolocation().removeWatcher({ id: handle.id })
    return
  }
  navigator.geolocation.clearWatch(handle)
}

// navigator.geolocation.getCurrentPosition과 같은 모양: 한 번만 위치를 받고 바로 watcher를 정리한다.
export function getCurrentPosition(onSuccess, onError, options = {}) {
  if (!isNative()) {
    navigator.geolocation.getCurrentPosition(onSuccess, onError, options)
    return
  }
  const bg = backgroundGeolocation()
  let settled = false
  const handle = { id: null }
  const timer = setTimeout(() => {
    if (settled) return
    settled = true
    if (handle.id != null) bg.removeWatcher({ id: handle.id })
    onError?.(new Error('위치를 확인하지 못했어요.'))
  }, options.timeout ?? 20000)
  bg.addWatcher({ requestPermissions: true, stale: false }, (location, error) => {
    if (settled) return
    if (error) { settled = true; clearTimeout(timer); onError?.(error); return }
    if (!location) return
    settled = true
    clearTimeout(timer)
    onSuccess(toPosition(location))
    if (handle.id != null) bg.removeWatcher({ id: handle.id })
  }).then(id => {
    handle.id = id
    if (settled) bg.removeWatcher({ id })
  })
}
