import {JobLeaseNotFoundError} from '@shipfox/runner-protocol/contract';
import {startHeartbeatLoop} from '#core/heartbeat-loop.js';

const heartbeatMock = vi.fn();

beforeEach(() => {
  heartbeatMock.mockReset();
  vi.useFakeTimers();
});

function start(ac: AbortController, options: {intervalMs: number; maxStaleMs: number}) {
  return startHeartbeatLoop('job-1', ac, options, {heartbeat: heartbeatMock});
}

describe('startHeartbeatLoop', () => {
  test('schedules first tick at intervalMs and calls heartbeat with the job id', async () => {
    heartbeatMock.mockResolvedValue({cancel: false});
    const ac = new AbortController();

    const handle = start(ac, {intervalMs: 100, maxStaleMs: 1000});

    // Flush any pending microtasks before asserting the timer has not fired —
    // a regression that resolved the first tick synchronously would leak past
    // an immediate `expect` without this.
    await Promise.resolve();
    expect(heartbeatMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(heartbeatMock).toHaveBeenCalledTimes(1);
    expect(heartbeatMock.mock.calls[0]?.[0]).toBe('job-1');
    expect(ac.signal.aborted).toBe(false);

    handle.stop();
  });

  test('single-flight: does not start a second tick until the first heartbeat resolves', async () => {
    let resolve: ((v: {cancel: boolean}) => void) | undefined;
    heartbeatMock.mockImplementation(() => new Promise<{cancel: boolean}>((r) => (resolve = r)));
    const ac = new AbortController();

    const handle = start(ac, {intervalMs: 100, maxStaleMs: 10_000});

    await vi.advanceTimersByTimeAsync(100);
    expect(heartbeatMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(500);
    expect(heartbeatMock).toHaveBeenCalledTimes(1);

    resolve?.({cancel: false});
    await vi.advanceTimersByTimeAsync(100);
    expect(heartbeatMock).toHaveBeenCalledTimes(2);

    handle.stop();
  });

  test('max-stale guard aborts the in-flight call and schedules the next tick', async () => {
    let receivedSignal: AbortSignal | undefined;
    heartbeatMock.mockImplementation(
      (_jobId: string, opts?: {signal?: AbortSignal}) =>
        new Promise<{cancel: boolean}>((_resolve, reject) => {
          receivedSignal = opts?.signal;
          opts?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );
    const ac = new AbortController();

    const handle = start(ac, {intervalMs: 100, maxStaleMs: 200});

    await vi.advanceTimersByTimeAsync(100);
    expect(heartbeatMock).toHaveBeenCalledTimes(1);
    expect(receivedSignal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(200);
    expect(receivedSignal?.aborted).toBe(true);

    await vi.advanceTimersByTimeAsync(100);
    expect(heartbeatMock).toHaveBeenCalledTimes(2);

    // Job's own AbortController is NOT aborted (the heartbeat-level abort is internal).
    expect(ac.signal.aborted).toBe(false);

    handle.stop();
  });

  test('cancel:true aborts the job AbortController and stops the loop', async () => {
    heartbeatMock.mockResolvedValueOnce({cancel: true});
    const ac = new AbortController();

    const handle = start(ac, {intervalMs: 100, maxStaleMs: 1000});

    await vi.advanceTimersByTimeAsync(100);
    expect(heartbeatMock).toHaveBeenCalledTimes(1);
    expect(ac.signal.aborted).toBe(true);

    await vi.advanceTimersByTimeAsync(500);
    expect(heartbeatMock).toHaveBeenCalledTimes(1);

    handle.stop();
  });

  test('JobLeaseNotFoundError aborts the job AbortController and stops the loop', async () => {
    heartbeatMock.mockRejectedValueOnce(new JobLeaseNotFoundError());
    const ac = new AbortController();

    const handle = start(ac, {intervalMs: 100, maxStaleMs: 1000});

    await vi.advanceTimersByTimeAsync(100);
    expect(heartbeatMock).toHaveBeenCalledTimes(1);
    expect(ac.signal.aborted).toBe(true);

    await vi.advanceTimersByTimeAsync(500);
    expect(heartbeatMock).toHaveBeenCalledTimes(1);

    handle.stop();
  });

  test('other errors are transient: log and schedule next tick', async () => {
    heartbeatMock.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({cancel: false});
    const ac = new AbortController();

    const handle = start(ac, {intervalMs: 100, maxStaleMs: 1000});

    await vi.advanceTimersByTimeAsync(100);
    expect(heartbeatMock).toHaveBeenCalledTimes(1);
    expect(ac.signal.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(100);
    expect(heartbeatMock).toHaveBeenCalledTimes(2);

    handle.stop();
  });

  test('stop() prevents future ticks and aborts any in-flight call', async () => {
    let aborted = false;
    heartbeatMock.mockImplementation(
      (_jobId: string, opts?: {signal?: AbortSignal}) =>
        new Promise<{cancel: boolean}>((_resolve, reject) => {
          opts?.signal?.addEventListener('abort', () => {
            aborted = true;
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );
    const ac = new AbortController();

    const handle = start(ac, {intervalMs: 100, maxStaleMs: 10_000});
    await vi.advanceTimersByTimeAsync(100);
    expect(heartbeatMock).toHaveBeenCalledTimes(1);

    handle.stop();
    expect(aborted).toBe(true);

    await vi.advanceTimersByTimeAsync(1000);
    expect(heartbeatMock).toHaveBeenCalledTimes(1);
  });
});
