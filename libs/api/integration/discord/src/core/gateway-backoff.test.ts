import {
  GATEWAY_BACKOFF_MAX_MS,
  GATEWAY_BACKOFF_MIN_MS,
  gatewayBackoffMs,
} from './gateway-backoff.js';

describe('gatewayBackoffMs', () => {
  it('starts at 5 seconds and doubles', () => {
    const delays = [0, 1, 2, 3].map((attempt) => gatewayBackoffMs({attempt, random: () => 0}));

    expect(delays).toEqual([5_000, 10_000, 20_000, 40_000]);
  });

  it('never exceeds the 5 minute ceiling however long the outage lasts', () => {
    const longest = Array.from({length: 200}, (_, attempt) =>
      gatewayBackoffMs({attempt, random: () => 0}),
    );
    const shortest = Array.from({length: 200}, (_, attempt) =>
      gatewayBackoffMs({attempt, random: () => 1}),
    );

    expect(Math.max(...longest)).toBe(GATEWAY_BACKOFF_MAX_MS);
    expect(Math.min(...shortest.slice(10))).toBeGreaterThanOrEqual(GATEWAY_BACKOFF_MAX_MS * 0.9);
  });

  it('only shortens the delay with jitter', () => {
    const shortest = gatewayBackoffMs({attempt: 0, random: () => 1});

    expect(shortest).toBeLessThan(GATEWAY_BACKOFF_MIN_MS);
    expect(shortest).toBeGreaterThanOrEqual(GATEWAY_BACKOFF_MIN_MS * 0.9);
  });
});
