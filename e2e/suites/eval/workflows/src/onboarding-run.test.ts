import {fileURLToPath} from 'node:url';
import {describe, expect, it} from '@shipfox/vitest/vi';
import {discoverOnboardingCases, runOnboardingSuite} from './onboarding-run.js';

const apiKeyPattern = /ANTHROPIC_API_KEY/u;

describe('onboarding suite', () => {
  it('discovers the fixture case', async () => {
    const cases = await discoverOnboardingCases(
      fileURLToPath(new URL('../cases/onboarding/', import.meta.url)),
    );

    expect(cases.map((entry) => entry.id)).toEqual(['fixture']);
  });

  it('filters cases by glob', async () => {
    const root = fileURLToPath(new URL('../cases/onboarding/', import.meta.url));

    expect(await discoverOnboardingCases(root, {filter: 'nothing-*'})).toEqual([]);
  });

  it('asks for the API key before it touches the stack', async () => {
    await expect(runOnboardingSuite({env: {}})).rejects.toThrow(apiKeyPattern);
  });
});
