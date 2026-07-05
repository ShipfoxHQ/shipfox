import {defineConfig} from '@shipfox/playwright';
import apiGlobalSetup from '../setup/api-global-setup.js';

export function defineApiE2eConfig() {
  return defineConfig({
    testDir: './tests',
    testMatch: '**/*.e2e.ts',
    globalSetup: apiGlobalSetup,
    reporter: process.env.CI ? 'github' : 'list',
    use: {
      trace: 'retain-on-failure',
    },
  });
}
