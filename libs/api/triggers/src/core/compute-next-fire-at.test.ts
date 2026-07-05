import {computeNextFireAt} from './compute-next-fire-at.js';

describe('computeNextFireAt', () => {
  test('returns the next occurrence strictly after the from instant', () => {
    const result = computeNextFireAt({
      cronExpression: '0 2 * * *',
      timezone: 'UTC',
      from: new Date('2026-01-01T02:00:00.000Z'),
      subscriptionId: crypto.randomUUID(),
      jitterWindowSeconds: 0,
    });

    expect(result).toEqual(new Date('2026-01-02T02:00:00.000Z'));
  });

  test('evaluates the schedule in the supplied timezone', () => {
    const result = computeNextFireAt({
      cronExpression: '0 2 * * *',
      timezone: 'America/New_York',
      from: new Date('2026-01-01T00:00:00.000Z'),
      subscriptionId: crypto.randomUUID(),
      jitterWindowSeconds: 0,
    });

    expect(result).toEqual(new Date('2026-01-01T07:00:00.000Z'));
  });

  test('applies deterministic jitter for the subscription', () => {
    const params = {
      cronExpression: '0 2 * * *',
      timezone: 'UTC',
      from: new Date('2026-01-01T00:00:00.000Z'),
      subscriptionId: crypto.randomUUID(),
      jitterWindowSeconds: 600,
    };

    const first = computeNextFireAt(params);
    const second = computeNextFireAt(params);

    expect(second).toEqual(first);
    expect(first.getTime()).toBeGreaterThanOrEqual(new Date('2026-01-01T02:00:00.000Z').getTime());
    expect(first.getTime()).toBeLessThan(new Date('2026-01-02T02:00:00.000Z').getTime());
  });

  test('does not jitter past the following occurrence', () => {
    const result = computeNextFireAt({
      cronExpression: '*/5 * * * *',
      timezone: 'UTC',
      from: new Date('2026-01-01T00:00:00.000Z'),
      subscriptionId: crypto.randomUUID(),
      jitterWindowSeconds: 60 * 60,
    });

    expect(result.getTime()).toBeGreaterThanOrEqual(new Date('2026-01-01T00:05:00.000Z').getTime());
    expect(result.getTime()).toBeLessThan(new Date('2026-01-01T00:10:00.000Z').getTime());
  });

  test('returns the exact occurrence when the jitter window is disabled', () => {
    const result = computeNextFireAt({
      cronExpression: '*/5 * * * *',
      timezone: 'UTC',
      from: new Date('2026-01-01T00:00:00.000Z'),
      subscriptionId: crypto.randomUUID(),
      jitterWindowSeconds: 0,
    });

    expect(result).toEqual(new Date('2026-01-01T00:05:00.000Z'));
  });
});
