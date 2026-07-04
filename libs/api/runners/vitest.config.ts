import {defineConfig, type UserConfigExport} from '@shipfox/vitest';

export default defineConfig(
  {
    test: {
      fileParallelism: false,
      globalSetup: ['test/globalSetup.ts'],
      isolate: false,
      maxWorkers: 1,
      setupFiles: ['test/setup.ts'],
    },
  },
  import.meta.url,
) as UserConfigExport;
