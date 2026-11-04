import {defineClientE2eConfig} from '@shipfox/e2e-kit/config';

export default defineClientE2eConfig({
  buildName: 'e2e-client-chat',
  globalSetup: './tests/global-setup.ts',
  // A test can chain two turn waits of up to 30 seconds each after its setup.
  timeout: 90_000,
});
