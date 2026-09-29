import {fileURLToPath} from 'node:url';
import {defineConfig, type UserConfigExport} from '@shipfox/vitest';

export default defineConfig(
  {
    resolve: {alias: {'@': fileURLToPath(new URL('./src', import.meta.url))}},
    test: {environment: 'node'},
  },
  import.meta.url,
) as UserConfigExport;
