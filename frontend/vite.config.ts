import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Read ports from the repo-root .env so they live alongside DB_PORT.
  const env = loadEnv(mode, '..', '')

  return {
    plugins: [react()],
    server: {
      port: Number(env.FRONTEND_PORT ?? 5173),
      strictPort: true,
      proxy: {
        '/api': `http://127.0.0.1:${env.API_PORT ?? 3000}`,
      },
    },
  }
})
