import type {UsageTokenTotals} from '#core/usage.js';
import {
  formatUsageCacheWrite,
  formatUsageDuration,
  formatUsageRate,
  usageTokenBreakdownTitle,
} from './usage-format.js';

const totals: UsageTokenTotals = {
  requestCount: 2,
  inputTokens: 1_200,
  cachedInputTokens: 100,
  cacheWriteTokens: 40,
  outputTokens: 500,
  totalTokens: 1_840,
  cacheHitRate: 100 / 1_300,
  reasoningTokens: 80,
  webSearchRequests: 3,
  reportedTokenCounts: [
    {
      dialect: 'anthropic-messages',
      inputTokens: 1_200,
      outputTokens: 500,
      cacheCreationTokens: 40,
      cacheReadTokens: 100,
      reasoningTokens: 80,
      webSearchRequests: 3,
    },
  ],
};

describe('formatUsageDuration', () => {
  test.each([
    [59.6, '1m 0s'],
    [119.6, '2m 0s'],
    [3_599.6, '1h 0m'],
  ])('rounds %s before deriving time units', (seconds, expected) => {
    expect(formatUsageDuration(seconds)).toBe(expected);
  });

  test.each([null, undefined, Number.NaN, -1])('rejects invalid duration %s', (seconds) => {
    expect(formatUsageDuration(seconds)).toBe('—');
  });
});

describe('usage token formatting', () => {
  test('formats cache hit rates and reported token details', () => {
    expect(formatUsageRate(100 / 1_300)).toBe('7.7%');
    expect(formatUsageCacheWrite(totals)).toBe('40');
    expect(usageTokenBreakdownTitle(totals)).toContain(
      'As reported: anthropic-messages: input 1,200, output 500, cache write 40, cache read 100, reasoning 80, web searches 3',
    );
  });

  test('omits cache write when no dialect reports it', () => {
    expect(
      formatUsageCacheWrite({
        ...totals,
        cacheWriteTokens: 0,
        reportedTokenCounts: [
          {
            dialect: 'openai-responses',
            inputTokens: 1_200,
            outputTokens: 500,
            cacheCreationTokens: 0,
            cacheReadTokens: 100,
            reasoningTokens: 80,
            webSearchRequests: 3,
          },
        ],
      }),
    ).toBe('—');
  });
});
