import react from '@vitejs/plugin-react';
import {defineConfig} from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    conditions: ['default'],
    dedupe: ['react', 'react-dom', '@tanstack/react-query', '@tanstack/react-router', 'jotai'],
  },
  ssr: {resolve: {conditions: ['default']}},
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/app.fixture.tsx'],
    server: {deps: {inline: [/@shipfox/, /@radix-ui/, /framer-motion/]}},
  },
});
