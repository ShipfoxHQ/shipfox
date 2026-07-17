import react from '@vitejs/plugin-react';
import {defineConfig} from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom', '@tanstack/react-query', '@tanstack/react-router', 'jotai'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/app.fixture.tsx'],
    server: {deps: {inline: true}},
  },
});
