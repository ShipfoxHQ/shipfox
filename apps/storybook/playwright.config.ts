import {defineConfig} from '@shipfox/playwright';

export default defineConfig({
  testDir: './test/smoke',
  testMatch: '**/*.e2e.ts',
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 60_000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm exec tsx scripts/serve-preview.ts',
    url: 'http://127.0.0.1:4173/',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
