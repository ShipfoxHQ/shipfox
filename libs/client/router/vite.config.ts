import {defineConfig} from '@shipfox/vite';
import {tanstackRouter} from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [tanstackRouter(), react()],
  build: {
    lib: {
      entry: 'src/index.ts',
      fileName: 'index',
      formats: ['es'],
      name: 'clientRouter',
    },
    rollupOptions: {
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        'jotai',
        'zod',
        '@tanstack/react-router',
        '@shipfox/client-api',
        '@shipfox/client-app-shell',
        '@shipfox/client-auth',
        '@shipfox/client-integrations',
        '@shipfox/client-projects',
        '@shipfox/react-ui',
      ],
    },
  },
});
