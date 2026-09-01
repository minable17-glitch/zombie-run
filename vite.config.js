import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { defineConfig } from 'vite'

// 실제 폰에서 GPS(Geolocation)를 테스트하려면 HTTPS(보안 컨텍스트)가 필요해서
// basicSsl 플러그인으로 로컬 개발 서버도 https로 띄움 (인증서 경고는 무시하고 진행하면 됨)
export default defineConfig({
  base: process.env.GH_PAGES ? '/zombie-run/' : '/',
  plugins: [react(), basicSsl()],
  server: {
    host: true,
  },
})
