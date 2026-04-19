import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  const apiTarget = env.VITE_API_TARGET || process.env.VITE_API_TARGET || 'http://localhost:3001'

  const apiProxy = {
    '/api': {
      target: apiTarget,
      changeOrigin: true
    }
  }

  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: false,
      proxy: apiProxy
    },
    preview: {
      proxy: apiProxy
    }
  }
})
