import {defineConfig} from '@shipfox/playwright';

// Scenarios share one suite arrangement (workspace, gitea org, connection, and a
// single docker provisioner) built once in global setup; they isolate through a
// fresh repo + project + unique names, so they run fully parallel. Keep the worker
// count at or below the e2e template's max_concurrency (see templates.e2e.yaml).
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
  timeout: 360_000,
  use: {
    trace: 'retain-on-failure',
  },
});
