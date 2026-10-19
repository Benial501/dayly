import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  define: { __DAYLY_BUILD_ID__: JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA || Date.now().toString()) },
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'assets/app.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: asset => asset.name?.endsWith('.css') ? 'assets/app.css' : 'assets/[name]-[hash][extname]',
      },
    },
  },
})
