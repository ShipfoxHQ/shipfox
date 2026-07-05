import {pollUntil} from './poll.js';

describe('pollUntil', () => {
  test('polls until the probe returns a value', async () => {
    let calls = 0;

    const result = await pollUntil(
      {
        describe: () => 'resource to appear',
        intervalMs: 1,
        timeoutMs: 100,
      },
      () => {
        calls += 1;
        return Promise.resolve(calls === 1 ? null : 'ready');
      },
    );

    expect(result).toBe('ready');
    expect(calls).toBe(2);
  });

  test('times out with the description and last probe error', async () => {
    const result = pollUntil(
      {
        describe: () => 'resource to appear',
        timeoutMs: 0,
      },
      () => Promise.reject(new Error('not yet')),
    );

    await expect(result).rejects.toThrow(
      'Timed out after 0ms waiting for resource to appear; last error: not yet',
    );
  });

  test('stops when the abort signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = pollUntil(
      {
        describe: () => 'resource to appear',
        signal: controller.signal,
        timeoutMs: 100,
      },
      () => Promise.resolve('ready'),
    );

    await expect(result).rejects.toThrow('Stopped waiting for resource to appear');
  });
});
