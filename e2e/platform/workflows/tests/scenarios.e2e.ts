import {runScenario} from '#run-scenario.js';
import {discoverScenarios} from '#scenarios.js';
import {expect, test} from './fixtures.js';

// Every scenarios/<name>/expect.yaml or reject.yaml directory becomes one Playwright
// test. Flows that need to orchestrate from outside (cancellation, listening jobs)
// ship their own tests/*.e2e.ts spec instead (e.g. tests/listener-jobs.e2e.ts) and are
// picked up directly by testMatch.
for (const scenario of discoverScenarios()) {
  test(scenario.name, async ({suite}, testInfo) => {
    const mismatches = await runScenario({
      scenario,
      suite,
      attach: async (attachment) => {
        await testInfo.attach(attachment.name, {
          body: attachment.body,
          contentType: attachment.contentType,
        });
      },
    });

    const summary = mismatches
      .map((mismatch) => `${mismatch.path}: expected ${mismatch.expected}, got ${mismatch.actual}`)
      .join('\n');
    expect(mismatches, summary).toEqual([]);
  });
}
