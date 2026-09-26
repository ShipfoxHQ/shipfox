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
  // The flow suite has its own CI runner, which also hosts the API, Temporal,
  // and the local runners.
  workers: 4,
  maxFailures: process.env.CI ? 1 : 0,
  // A scenario waits on real provisioning and execution; its own poll budgets
  // (expect.yaml timeout_seconds, plus the helper defaults) are the real deadlines,
  // so keep the Playwright per-test timeout comfortably above them.
  timeout: 360_000,
  use: {
    trace: 'retain-on-failure',
  },
});
