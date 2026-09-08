import type {ClientUsagePricing, UsagePricingCost} from '@shipfox/client-shell/runtime';
import {formatUsageCost, usagePricingCostFromResolution} from './usage-cost.js';

describe('usage pricing values', () => {
  const reference = {kind: 'run' as const, id: 'run-1'};
  const cost: UsagePricingCost = {amount: 1.2, state: 'resolved'};

  test.each([
    new Map([['run:run-1', cost]]),
    new Map([['run-1', cost]]),
    {'run:run-1': cost},
    {'run-1': cost},
    [{...reference, ...cost}],
  ])('reads a supported resolution shape', (resolution) => {
    expect(usagePricingCostFromResolution(resolution, reference)).toMatchObject(cost);
  });

  test('matches model and upstream dimensions in array resolutions', () => {
    const first = {
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
      usagePricingCostFromResolution({'run:run-1': {amount, state: 'resolved'}}, reference),
    ).toBeUndefined();
  });
});
