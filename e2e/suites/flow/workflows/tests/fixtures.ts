import {test as base} from '@shipfox/e2e-core/playwright';
import {markSuiteFailed, readSuiteContext, type SuiteContext} from '#suite-context.js';

export interface SuiteFixtures {
  suite: SuiteContext;
  failureTracker: undefined;
}

export const test = base.extend<SuiteFixtures>({
  suite: async ({request: _request}, use) => {
    await use(readSuiteContext());
  },
  // Auto fixture: a worker touches the shared failure sentinel when its test does not
  // reach the expected status, so global teardown keeps the run's gitea org for
  // inspection instead of deleting it.
  failureTracker: [
    async ({request: _request}, use, testInfo) => {
      await use(undefined);
      if (testInfo.status !== testInfo.expectedStatus) markSuiteFailed();
    },
    {auto: true},
  ],
});

export {expect} from '@shipfox/e2e-core/playwright';
