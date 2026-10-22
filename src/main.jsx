import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import './tactical-ui.css'
import './ranking.css'
import App from './App.jsx'

// 웹사이트를 크롬 "앱 설치"(PWA)로 쓸 수 있게 하는 등록. 안드로이드 APK(Capacitor) 안에서는 필요 없어서 건너뛴다.
if (import.meta.env.PROD && 'serviceWorker' in navigator && !window.Capacitor?.isNativePlatform?.()) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {})
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
