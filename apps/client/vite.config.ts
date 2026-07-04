import {defineConfig} from '@shipfox/vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';

const rawPort = process.env.SHIPFOX_CLIENT_PORT ?? process.env.VITE_PORT;
const port = Number(rawPort ?? 5173);

if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
  throw new Error(
    `Client port must be a valid TCP port (1-65535); got ${rawPort} from SHIPFOX_CLIENT_PORT or VITE_PORT`,
  );
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port,
    open: process.env.SHIPFOX_CLIENT_OPEN === '1',
    // Worktree ports must fail fast instead of silently shifting to another port.
    strictPort: true,
  },
  preview: {
    port,
    strictPort: true,
  },
});
