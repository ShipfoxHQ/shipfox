import {fileURLToPath} from 'node:url';
import {describe, expect, it} from '@shipfox/vitest/vi';
import {discoverOnboardingCases, runOnboardingSuite} from './onboarding-run.js';
import {outOfBudget} from './results.js';

const apiKeyPattern = /ANTHROPIC_API_KEY/u;

describe('onboarding suite', () => {
  it('discovers the shipped cases by their directory', async () => {
    const cases = await discoverOnboardingCases(
      fileURLToPath(new URL('../cases/onboarding/', import.meta.url)),
      {filter: 'close-templates-*'},
    );

    expect(cases.map((entry) => entry.id)).toEqual([
      'close-templates-default-branch-ci',
      'close-templates-dependency-pr-ci',
    ]);
  });

  it('filters cases by glob', async () => {
    const root = fileURLToPath(new URL('../cases/onboarding/', import.meta.url));

    expect(await discoverOnboardingCases(root, {filter: 'nothing-*'})).toEqual([]);
  });

  it('asks for the API key before it touches the stack', async () => {
    await expect(runOnboardingSuite({env: {}})).rejects.toThrow(apiKeyPattern);
  });

  it('stops starting repeats once the budget is spent', () => {
    const results = [{cost_usd: 0.6}, {cost_usd: 0.5}];

    expect(outOfBudget({results, maxCostUsd: 1})).toBe(true);
    expect(outOfBudget({results, maxCostUsd: 2})).toBe(false);
    expect(outOfBudget({results, maxCostUsd: undefined})).toBe(false);
  });
});
