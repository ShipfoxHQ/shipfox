import {boundedMap} from './bounded-map.js';

describe('boundedMap', () => {
  it('preserves result order while respecting the concurrency limit', async () => {
    let active = 0;
    let maxActive = 0;

    const results = await boundedMap([30, 10, 20, 5], 2, async (delay, index) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, delay));
      active -= 1;
      return index;
    });

    expect(results).toEqual([0, 1, 2, 3]);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it('continues remaining work when stopOnError is false', async () => {
    const seen: number[] = [];

    const result = boundedMap(
      [1, 2, 3],
      1,
      async (value) => {
        await Promise.resolve();
        seen.push(value);
        if (value === 2) throw new Error('boom');
        return value;
      },
      {stopOnError: false},
    );

    await expect(result).rejects.toThrow(AggregateError);
    expect(seen).toEqual([1, 2, 3]);
  });

  it('aborts pending work when stopOnError is true', async () => {
    const seen: number[] = [];

    const result = boundedMap(
      [1, 2, 3],
      1,
      async (value) => {
        await Promise.resolve();
        seen.push(value);
        if (value === 2) throw new Error('boom');
        return value;
      },
      {stopOnError: true},
    );

    await expect(result).rejects.toThrow('boom');
    expect(seen).toEqual([1, 2]);
  });
});
