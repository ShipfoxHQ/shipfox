import {defineConfig} from '@shipfox/playwright';

// Scenarios share one suite arrangement (workspace, gitea org, and connection)
// built once in global setup. Each test starts a local source runner with a unique
// label, so scenarios isolate through fresh repos, projects, names, and runners.
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.e2e.ts',
  globalSetup: './tests/global-setup.ts',
  globalTeardown: './tests/global-teardown.ts',
  reporter: process.env.CI ? 'github' : 'list',
  fullyParallel: true,
  workers: 4,
  // A scenario waits on real provisioning and execution; its own poll budgets
  // (expect.yaml timeout_seconds, plus the helper defaults) are the real deadlines,
  // so keep the Playwright per-test timeout comfortably above them.
  timeout: 450_000,
  use: {
    trace: 'retain-on-failure',
  },
});
