import {shipfoxClientComposition, shipfoxClientManifest} from '@shipfox/client-shell/vite';
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

const config = defineConfig({
  build: {chunkSizeWarningLimit: 4_000},
  plugins: [
    shipfoxClientManifest(),
    shipfoxClientComposition({
      features:
        process.env.SHIPFOX_COMPOSITION_COLLISION === '1'
          ? './src/features.collision.ts'
          : './src/features.ts',
    }),
    react(),
  ],
  resolve: {
    dedupe: ['react', 'react-dom', '@tanstack/react-query', '@tanstack/react-router', 'jotai'],
  },
});

export default config;
