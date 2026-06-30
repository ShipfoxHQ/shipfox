import {defineConfig} from '@shipfox/vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';

const rawPort = process.env.SHIPFOX_CLIENT_PORT ?? process.env.VITE_PORT;
const port = Number(rawPort ?? 5173);

if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
  throw new Error(`SHIPFOX_CLIENT_PORT must be a valid TCP port; got ${rawPort}`);
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port,
    strictPort: true,
  },
  preview: {
    port,
    strictPort: true,
  },
});
