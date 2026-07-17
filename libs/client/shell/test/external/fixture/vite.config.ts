import {shipfoxClientComposition} from '@shipfox/client-shell/vite';
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

const features = process.env.SHIPFOX_COMPOSITION_COLLISION
  ? './src/features.collision.ts'
  : './src/features.ts';

export default defineConfig({
  build: {chunkSizeWarningLimit: 4_000},
  plugins: [react(), shipfoxClientComposition({features})],
  resolve: {
    dedupe: ['react', 'react-dom', '@tanstack/react-query', '@tanstack/react-router', 'jotai'],
    tsconfigPaths: true,
  },
});
