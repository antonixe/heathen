import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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
