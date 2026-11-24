import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import './tactical-ui.css'
import './ranking.css'
import App from './App.jsx'
import { watchForNewVersion } from './lib/autoUpdate.js'

// 웹사이트를 크롬 "앱 설치"(PWA)로 쓸 수 있게 하는 등록. 안드로이드 APK(Capacitor) 안에서는 필요 없어서 건너뛴다.
if (import.meta.env.PROD && 'serviceWorker' in navigator && !window.Capacitor?.isNativePlatform?.()) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {})
  })
}

// 배포 직후에도 예전 화면이 남지 않게 — 안드로이드 APK 안에서는 화면이 앱에 들어 있어 의미가 없다
if (import.meta.env.PROD && !window.Capacitor?.isNativePlatform?.()) watchForNewVersion(import.meta.env.BASE_URL)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
