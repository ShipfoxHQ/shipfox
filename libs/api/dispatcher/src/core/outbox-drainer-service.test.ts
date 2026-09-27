import {createOutboxRegistry} from '@shipfox/node-module';
import {createOutboxDrainerService} from './outbox-drainer-service.js';

const context = {outboxRegistry: createOutboxRegistry()};
const idle = {claimed: 0, hasMore: false};
const errorMonitoring = vi.hoisted(() => ({reportError: vi.fn()}));

vi.mock('@shipfox/node-error-monitoring', () => errorMonitoring);

afterEach(() => vi.clearAllMocks());

describe('createOutboxDrainerService', () => {
  it('drains pending batches before idling and stops without another claim', async () => {
    const drain = vi
      .fn()
      .mockResolvedValueOnce({claimed: 500, hasMore: true})
      .mockResolvedValueOnce({claimed: 3, hasMore: false});
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

    const handle = await service.start(context);
    await vi.waitFor(() => expect(sleeps).toEqual([25]));

    await handle.stop();
    await handle.finished;

    expect(drain).toHaveBeenCalledTimes(2);
  });

  it('passes the abort signal to the drain function so an in-flight cycle can stop early on shutdown', async () => {
    const drain = vi.fn().mockResolvedValueOnce(idle);
    const service = createOutboxDrainerService({
      pollMs: 25,
      runDrainCycle: drain,
      sleep: async (_ms, signal) => {
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), {once: true}),
        );
      },
    });

    const handle = await service.start(context);
    await vi.waitFor(() => expect(drain).toHaveBeenCalledTimes(1));

    await handle.stop();

    expect(drain).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it('logs escaped errors, backs off, and continues draining', async () => {
    const failure = new Error('database unavailable');
    const drain = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(idle);
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

    const handle = await service.start(context);
    await vi.waitFor(() => expect(sleeps).toEqual([1_000, 50]));

    await handle.stop();

    expect(drain).toHaveBeenCalledTimes(2);
    expect(logError).toHaveBeenCalledWith(failure);
  });

  it('reports an unexpected drain-loop failure when no caller reporter is supplied', async () => {
    const failure = new Error('database unavailable');
    const drain = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(idle);
    const service = createOutboxDrainerService({
      pollMs: 25,
      runDrainCycle: drain,
      sleep: async (ms, signal) => {
        if (ms === 1_000) return;
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), {once: true}),
        );
      },
    });

    const handle = await service.start(context);
    await vi.waitFor(() => expect(drain).toHaveBeenCalledTimes(2));
    await handle.stop();

    expect(errorMonitoring.reportError).toHaveBeenCalledWith(failure, {
      boundary: 'dispatcher.drain',
    });
  });

  it('backs off while the outbox stays empty and returns to the poll interval after a claim', async () => {
    const drain = vi
      .fn()
      .mockResolvedValueOnce(idle)
      .mockResolvedValueOnce(idle)
      .mockResolvedValueOnce(idle)
      .mockResolvedValueOnce(idle)
      .mockResolvedValueOnce(idle)
      .mockResolvedValueOnce({claimed: 1, hasMore: false})
      .mockResolvedValue(idle);
    const sleeps: number[] = [];
    const service = createOutboxDrainerService({
      pollMs: 250,
      runDrainCycle: drain,
      onWrite: () => () => undefined,
      sleep: async (ms, signal) => {
        sleeps.push(ms);
        if (sleeps.length < 8) return;
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), {once: true}),
        );
      },
    });

    const handle = await service.start(context);
    await vi.waitFor(() => expect(sleeps).toHaveLength(8));
    await handle.stop();

    expect(sleeps).toEqual([500, 1_000, 2_000, 2_000, 2_000, 250, 500, 1_000]);
  });

  it('cuts an idle wait short after an outbox write and polls one interval later', async () => {
    let notifyWrite: (() => void) | undefined;
    const unsubscribe = vi.fn();
    const drain = vi.fn().mockResolvedValue(idle);
    const sleeps: number[] = [];
    const service = createOutboxDrainerService({
      pollMs: 250,
      runDrainCycle: drain,
      onWrite: (listener) => {
        notifyWrite = listener;
        return unsubscribe;
      },
      sleep: async (ms, signal) => {
        sleeps.push(ms);
        if (ms === 250) return;
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), {once: true}),
        );
      },
    });

    const handle = await service.start(context);
    await vi.waitFor(() => expect(sleeps).toEqual([500]));
    notifyWrite?.();
    await vi.waitFor(() => expect(sleeps).toEqual([500, 250, 500]));
    await handle.stop();

    expect(drain).toHaveBeenCalledTimes(2);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
