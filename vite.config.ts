import { defineConfig } from 'vite'
import { nitro } from 'nitro/vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue(), nitro()],
  server: {
    allowedHosts: ['host.docker.internal'],
  },
})
