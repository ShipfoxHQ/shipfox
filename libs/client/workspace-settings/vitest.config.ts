import {defineConfig, type UserConfigExport} from '@shipfox/vitest';

export default defineConfig(
  {
    test: {
      environment: 'jsdom',
      // Files are isolation-safe (test/setup.ts resets DOM + api client), so reuse the
      // module graph across files in a worker instead of re-importing it per file.
      isolate: false,
      setupFiles: ['test/setup.ts'],
    },
  },
  import.meta.url,
) as UserConfigExport;
