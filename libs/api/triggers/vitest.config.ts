import {defineConfig, type UserConfigExport} from '@shipfox/vitest';

export default defineConfig(
  {
    test: {
      // Test files share real PostgreSQL tables, including cron schedule and trigger history state.
      // Keep files serial so concurrent fixtures cannot contend on the same rows.
      fileParallelism: false,
      globalSetup: ['test/globalSetup.ts'],
      setupFiles: ['test/setup.ts'],
    },
  },
  import.meta.url,
) as UserConfigExport;
