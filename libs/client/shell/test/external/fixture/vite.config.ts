import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

export default defineConfig({
  build: {chunkSizeWarningLimit: 4_000},
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom', '@tanstack/react-query', '@tanstack/react-router', 'jotai'],
  },
});
