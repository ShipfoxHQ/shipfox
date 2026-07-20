import {createOutboxDrainerService} from './outbox-drainer-service.js';

describe('createOutboxDrainerService', () => {
  it('drains pending batches before idling and stops without another claim', async () => {
    const drain = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const sleeps: number[] = [];
    const service = createOutboxDrainerService({
      pollMs: 25,
      runDrainCycle: drain,
      sleep: async (ms, signal) => {
        sleeps.push(ms);
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), {once: true}),
        );
      },
    });

    const handle = await service.start();
    await vi.waitFor(() => expect(sleeps).toEqual([25]));

    await handle.stop();
    await handle.finished;

    expect(drain).toHaveBeenCalledTimes(2);
  });

  it('passes the abort signal to the drain function so an in-flight cycle can stop early on shutdown', async () => {
    const drain = vi.fn().mockResolvedValueOnce(false);
    const service = createOutboxDrainerService({
      pollMs: 25,
      runDrainCycle: drain,
      sleep: async (_ms, signal) => {
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), {once: true}),
        );
      },
    });

    const handle = await service.start();
    await vi.waitFor(() => expect(drain).toHaveBeenCalledTimes(1));

    await handle.stop();

    expect(drain).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it('logs escaped errors, backs off, and continues draining', async () => {
    const failure = new Error('database unavailable');
    const drain = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(false);
    const sleeps: number[] = [];
    const logError = vi.fn();
    const service = createOutboxDrainerService({
      pollMs: 25,
      runDrainCycle: drain,
      sleep: async (ms, signal) => {
        sleeps.push(ms);
        if (ms === 1_000) return;
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), {once: true}),
        );
      },
      logError,
    });

    const handle = await service.start();
    await vi.waitFor(() => expect(sleeps).toEqual([1_000, 25]));

    await handle.stop();

    expect(drain).toHaveBeenCalledTimes(2);
    expect(logError).toHaveBeenCalledWith(failure);
  });
});
