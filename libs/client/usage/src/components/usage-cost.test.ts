import type {
  ClientUsagePricing,
  UsagePricingCost,
  UsagePricingResolution,
} from '@shipfox/client-shell/runtime';
import {formatUsageCost, usagePricingCostFromResolution} from './usage-cost.js';

describe('usage pricing values', () => {
  const reference = {workspaceId: 'workspace-a', kind: 'run' as const, id: 'run-1'};
  const cost: UsagePricingCost = {amount: 1.2, state: 'resolved'};

  test.each([
    new Map([['workspace-a:run:run-1', cost]]),
    {'workspace-a:run:run-1': cost},
    [{...reference, ...cost}],
  ])('reads a supported resolution shape', (resolution) => {
    expect(usagePricingCostFromResolution(resolution, reference)).toMatchObject(cost);
  });

  test('matches model and upstream dimensions in array resolutions', () => {
    const first = {
      workspaceId: 'workspace-a',
      kind: 'step-attempt' as const,
      id: 'attempt-1',
      model: 'model-a',
      upstream: 'upstream-a',
    };
    const second = {...first, model: 'model-b'};

    expect(
      usagePricingCostFromResolution(
        [
          {...first, amount: 1, state: 'resolved' as const},
          {...second, amount: 2, state: 'resolved' as const},
        ],
        second,
      ),
    ).toMatchObject({amount: 2});
  });

  test('requires exact model-scoped costs for model rows', () => {
    const first = {
      workspaceId: 'workspace-a',
      kind: 'step-attempt' as const,
      id: 'attempt-1',
      model: 'model-a',
      upstream: 'upstream-a',
    };
    const second = {...first, model: 'model-b'};
    const aggregate: UsagePricingCost = {amount: 3, state: 'resolved'};
    const resolutions: UsagePricingResolution[] = [
      new Map([['workspace-a:step-attempt:attempt-1', aggregate]]),
      {'workspace-a:step-attempt:attempt-1': aggregate},
      [{workspaceId: 'workspace-a', kind: 'step-attempt', id: 'attempt-1', ...aggregate}],
    ];

    for (const resolution of resolutions) {
      expect(usagePricingCostFromResolution(resolution, first)).toBeUndefined();
      expect(usagePricingCostFromResolution(resolution, second)).toBeUndefined();
      expect(
        usagePricingCostFromResolution(resolution, {
          workspaceId: 'workspace-a',
          kind: 'step-attempt',
          id: 'attempt-1',
        }),
      ).toMatchObject(aggregate);
    }
  });

  test('does not resolve a cost from another workspace', () => {
    const resolution = [
      {
        workspaceId: 'workspace-b',
        kind: 'run' as const,
        id: 'run-1',
        amount: 3,
        state: 'resolved' as const,
      },
    ];

    expect(usagePricingCostFromResolution(resolution, reference)).toBeUndefined();
  });

  test.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])('does not format a non-finite breakdown amount: %s', (amount) => {
    const formatMoney = vi.fn((value: number) => `$${value}`);
    const pricing: ClientUsagePricing = {
      formatMoney,
      resolveCosts: () => new Map(),
      estimate: () => null,
    };
    expect(formatUsageCost(pricing, {amount, state: 'resolved'})).toBeUndefined();
    expect(formatMoney).not.toHaveBeenCalled();
    expect(
      usagePricingCostFromResolution(
        {'workspace-a:run:run-1': {amount, state: 'resolved'}},
        reference,
      ),
    ).toBeUndefined();
  });
});
