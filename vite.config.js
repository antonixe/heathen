import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.PORT) || 5173,
  },
  test: {
    globals: true,
    setupFiles: './src/test/setup.js',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  base: './',
  build: {
    target: 'es2020',
    sourcemap: true,
    rollupOptions: {
      output: {
        onlyExplicitManualChunks: true,
        manualChunks: {
          vendor: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
          dexie: ['dexie'],
          'charts-vendor': [
            'victory-vendor/d3-array',
            'victory-vendor/d3-ease',
            'victory-vendor/d3-interpolate',
            'victory-vendor/d3-scale',
            'victory-vendor/d3-shape',
            'victory-vendor/d3-time',
            'victory-vendor/d3-timer',
          ],
          recharts: ['recharts'],
        },
      },
    },
  },
})
