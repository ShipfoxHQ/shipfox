import {registerModuleMetrics, runModuleStartupTasks, startModuleWorkers} from './initialize.js';
import type {ModuleWorker, ShipfoxModule} from './types.js';

const mocks = vi.hoisted(() => ({
  closeTemporalClient: vi.fn(),
  createTemporalClient: vi.fn(),
  createTemporalWorker: vi.fn(),
  createTemporalWorkerConnection: vi.fn(),
  workflowStart: vi.fn(),
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@shipfox/node-temporal', () => ({
  closeTemporalClient: mocks.closeTemporalClient,
  createTemporalClient: mocks.createTemporalClient,
  createTemporalWorker: mocks.createTemporalWorker,
  createTemporalWorkerConnection: mocks.createTemporalWorkerConnection,
  temporalClient: () => ({workflow: {start: mocks.workflowStart}}),
}));

vi.mock('@shipfox/node-opentelemetry', () => ({
  logger: () => mocks.logger,
}));

describe('registerModuleMetrics', () => {
  it('invokes the metrics hook for each module that declares one', () => {
    const first = vi.fn();
    const second = vi.fn();
    const modules: ShipfoxModule[] = [
      {name: 'first', metrics: first},
      {name: 'second', metrics: second},
    ];

    registerModuleMetrics({modules});

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });

  it('skips modules that declare no metrics hook', () => {
    const withMetrics = vi.fn();
    const modules: ShipfoxModule[] = [{name: 'none'}, {name: 'has', metrics: withMetrics}];

    registerModuleMetrics({modules});

    expect(withMetrics).toHaveBeenCalledOnce();
  });

  it('isolates a throwing hook so later modules still register', () => {
    const later = vi.fn();
    const modules: ShipfoxModule[] = [
      {
        name: 'throwing',
        metrics: () => {
          throw new Error('registration failed');
        },
      },
      {name: 'later', metrics: later},
    ];

    registerModuleMetrics({modules});

    expect(later).toHaveBeenCalledOnce();
  });
});

describe('runModuleStartupTasks', () => {
  it('runs startup tasks sequentially in module order', async () => {
    const calls: string[] = [];
    const modules: ShipfoxModule[] = [
      {
        name: 'first',
        startupTasks: async () => {
          calls.push('first:start');
          await Promise.resolve();
          calls.push('first:end');
        },
      },
      {name: 'none'},
      {
        name: 'second',
        startupTasks: () => {
          calls.push('second');
          return Promise.resolve();
        },
      },
    ];

    await runModuleStartupTasks({modules});

    expect(calls).toEqual(['first:start', 'first:end', 'second']);
  });

  it('propagates a startup task failure without running later tasks', async () => {
    const failure = new Error('task failed');
    const later = vi.fn();

    const result = runModuleStartupTasks({
      modules: [
        {name: 'failing', startupTasks: async () => Promise.reject(failure)},
        {name: 'later', startupTasks: later},
      ],
    });

    await expect(result).rejects.toBe(failure);
    expect(later).not.toHaveBeenCalled();
  });
});

function moduleWorker(overrides: Partial<ModuleWorker> = {}): ModuleWorker {
  return {
    taskQueue: 'test-queue',
    workflowsPath: '/tmp/workflows.js',
    activities: () => ({}),
    workflows: [],
    ...overrides,
  };
}

function temporalWorker(runResult: Promise<void> = new Promise(() => undefined)) {
  return {
    run: vi.fn(() => runResult),
    shutdown: vi.fn(),
  };
}

function alreadyStartedError(): Error {
  const error = new Error('already started');
  error.name = 'WorkflowExecutionAlreadyStartedError';
  return error;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('startModuleWorkers', () => {
  beforeEach(() => {
    mocks.closeTemporalClient.mockReset();
    mocks.createTemporalClient.mockReset();
    mocks.createTemporalWorker.mockReset();
    mocks.createTemporalWorkerConnection.mockReset();
    mocks.workflowStart.mockReset();
    mocks.logger.error.mockReset();
    mocks.logger.info.mockReset();
    mocks.logger.warn.mockReset();
    mocks.closeTemporalClient.mockResolvedValue(undefined);
    mocks.createTemporalClient.mockResolvedValue({});
    mocks.createTemporalWorkerConnection.mockResolvedValue({close: vi.fn()});
    mocks.createTemporalWorker.mockResolvedValue(temporalWorker());
    mocks.workflowStart.mockResolvedValue({});
  });

  it('returns a no-op handle without Temporal resources when no workers are declared', async () => {
    const handle = await startModuleWorkers({workers: []});

    await handle.stop();

    expect(mocks.createTemporalClient).not.toHaveBeenCalled();
    expect(mocks.createTemporalWorkerConnection).not.toHaveBeenCalled();
    expect(mocks.closeTemporalClient).not.toHaveBeenCalled();
  });

  it('shares one Temporal worker connection across workers', async () => {
    const connection = {close: vi.fn()};
    mocks.createTemporalWorkerConnection.mockResolvedValue(connection);

    await startModuleWorkers({
      workers: [moduleWorker({taskQueue: 'first'}), moduleWorker({taskQueue: 'second'})],
    });

    expect(mocks.createTemporalWorkerConnection).toHaveBeenCalledOnce();
    expect(mocks.createTemporalWorker).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({connection}),
    );
    expect(mocks.createTemporalWorker).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({connection}),
    );
  });

  it('rejects when Temporal client creation fails', async () => {
    const failure = new Error('temporal unavailable');
    mocks.createTemporalClient.mockRejectedValueOnce(failure);

    const result = startModuleWorkers({workers: [moduleWorker()]});

    await expect(result).rejects.toBe(failure);
  });

  it('closes the Temporal client when worker connection creation fails', async () => {
    const failure = new Error('worker connection unavailable');
    mocks.createTemporalWorkerConnection.mockRejectedValueOnce(failure);

    const result = startModuleWorkers({workers: [moduleWorker()]});

    await expect(result).rejects.toBe(failure);
    expect(mocks.closeTemporalClient).toHaveBeenCalledOnce();
  });

  it('wraps worker creation failures with the task queue and original cause', async () => {
    const failure = new Error('missing workflows file');
    mocks.createTemporalWorker.mockRejectedValueOnce(failure);

    const result = startModuleWorkers({workers: [moduleWorker({taskQueue: 'broken-queue'})]});

    await expect(result).rejects.toThrow(
      'Failed to start module worker for task queue broken-queue',
    );
    await result.catch((error: unknown) => {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).cause).toBe(failure);
    });
  });

  it('wraps activity factory failures with the task queue and original cause', async () => {
    const failure = new Error('activity config missing');

    const result = startModuleWorkers({
      workers: [
        moduleWorker({
          taskQueue: 'activity-queue',
          activities: () => {
            throw failure;
          },
        }),
      ],
    });

    await expect(result).rejects.toThrow(
      'Failed to start module worker for task queue activity-queue',
    );
    await result.catch((error: unknown) => {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).cause).toBe(failure);
    });
  });

  it('starts declared workflows with their task queue and cron schedule', async () => {
    await startModuleWorkers({
      workers: [
        moduleWorker({
          workflows: [{name: 'pruneCron', id: 'prune-cron', cronSchedule: '0 * * * *'}],
        }),
      ],
    });

    expect(mocks.workflowStart).toHaveBeenCalledWith('pruneCron', {
      taskQueue: 'test-queue',
      workflowId: 'prune-cron',
      cronSchedule: '0 * * * *',
    });
  });

  it('starts declared workflows with args when provided', async () => {
    const args = [{workerIndex: 1, workerCount: 4}];

    await startModuleWorkers({
      workers: [moduleWorker({workflows: [{name: 'dispatch', id: 'dispatch-1', args}]})],
    });

    expect(mocks.workflowStart).toHaveBeenCalledWith('dispatch', {
      taskQueue: 'test-queue',
      workflowId: 'dispatch-1',
      args,
    });
  });

  it('tolerates already-started workflows', async () => {
    mocks.workflowStart.mockRejectedValueOnce(alreadyStartedError());

    await startModuleWorkers({
      workers: [moduleWorker({workflows: [{name: 'cron', id: 'cron'}]})],
    });

    expect(mocks.logger.info).toHaveBeenCalledWith(
      {workflowId: 'cron'},
      'Workflow already running, skipping start',
    );
  });

  it('wraps unexpected workflow start failures with the task queue and original cause', async () => {
    const failure = new Error('workflow service unavailable');
    const worker = temporalWorker();
    mocks.workflowStart.mockRejectedValueOnce(failure);
    mocks.createTemporalWorker.mockResolvedValueOnce(worker);

    const result = startModuleWorkers({
      workers: [
        moduleWorker({taskQueue: 'workflow-queue', workflows: [{name: 'cron', id: 'cron'}]}),
      ],
    });

    await expect(result).rejects.toThrow(
      'Failed to start module worker for task queue workflow-queue',
    );
    await result.catch((error: unknown) => {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).cause).toBe(failure);
    });
    expect(worker.shutdown).toHaveBeenCalledOnce();
    expect(mocks.closeTemporalClient).toHaveBeenCalledOnce();
  });

  it('calls the runtime failure callback when a started worker stops unexpectedly', async () => {
    const failure = new Error('poller failed');
    const worker = moduleWorker({taskQueue: 'runtime-queue'});
    const onWorkerFailure = vi.fn();
    mocks.createTemporalWorker.mockResolvedValueOnce(temporalWorker(Promise.reject(failure)));

    await startModuleWorkers({workers: [worker], onWorkerFailure});
    await flushMicrotasks();

    expect(onWorkerFailure).toHaveBeenCalledWith(failure, worker);
    expect(mocks.logger.error).not.toHaveBeenCalledWith(
      expect.anything(),
      'Worker stopped unexpectedly',
    );
  });

  it('logs the original worker failure when the runtime failure callback rejects', async () => {
    const failure = new Error('poller failed');
    const handlerFailure = new Error('shutdown failed');
    const worker = moduleWorker({taskQueue: 'runtime-queue'});
    const onWorkerFailure = vi.fn().mockRejectedValue(handlerFailure);
    mocks.createTemporalWorker.mockResolvedValueOnce(temporalWorker(Promise.reject(failure)));

    await startModuleWorkers({workers: [worker], onWorkerFailure});
    await flushMicrotasks();

    expect(onWorkerFailure).toHaveBeenCalledWith(failure, worker);
    expect(mocks.logger.error).toHaveBeenCalledWith(
      {err: handlerFailure, workerErr: failure, taskQueue: 'runtime-queue'},
      'Module worker failure handler failed',
    );
  });

  it('logs runtime worker failures when no failure callback is provided', async () => {
    const failure = new Error('poller failed');
    mocks.createTemporalWorker.mockResolvedValueOnce(temporalWorker(Promise.reject(failure)));

    await startModuleWorkers({workers: [moduleWorker({taskQueue: 'runtime-queue'})]});
    await flushMicrotasks();

    expect(mocks.logger.error).toHaveBeenCalledWith(
      {err: failure, taskQueue: 'runtime-queue'},
      'Worker stopped unexpectedly',
    );
  });

  it('stops every worker, logs deliberate-stop failures, and closes Temporal resources in order', async () => {
    const failure = new Error('forced shutdown timeout');
    const shutdownFailure = new Error('worker not running');
    const connection = {close: vi.fn().mockResolvedValue(undefined)};
    let rejectRun: (error: Error) => void = () => undefined;
    const runPromise = new Promise<void>((_resolve, reject) => {
      rejectRun = reject;
    });
    const firstWorker = temporalWorker(runPromise);
    firstWorker.shutdown.mockImplementation(() => {
      throw shutdownFailure;
    });
    const secondWorker = temporalWorker(Promise.resolve());
    const onWorkerFailure = vi.fn();
    mocks.createTemporalWorkerConnection.mockResolvedValue(connection);
    mocks.createTemporalWorker
      .mockResolvedValueOnce(firstWorker)
      .mockResolvedValueOnce(secondWorker);

    const handle = await startModuleWorkers({
      workers: [moduleWorker({taskQueue: 'first'}), moduleWorker({taskQueue: 'second'})],
      onWorkerFailure,
    });
    const firstStop = handle.stop();
    const secondStop = handle.stop();

    await flushMicrotasks();

    expect(connection.close).not.toHaveBeenCalled();
    rejectRun(failure);

    await firstStop;

    expect(secondStop).toBe(firstStop);
    expect(firstWorker.shutdown).toHaveBeenCalledOnce();
    expect(secondWorker.shutdown).toHaveBeenCalledOnce();
    expect(onWorkerFailure).not.toHaveBeenCalled();
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      {err: shutdownFailure},
      'Failed to shut down module worker',
    );
    expect(mocks.logger.error).toHaveBeenCalledWith(
      {err: failure},
      'Module worker stopped with an error',
    );
    expect(connection.close.mock.invocationCallOrder[0]).toBeGreaterThan(
      secondWorker.shutdown.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mocks.closeTemporalClient.mock.invocationCallOrder[0]).toBeGreaterThan(
      connection.close.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('identifies the failing task queue when a later worker fails to start', async () => {
    const failure = new Error('second worker missing');
    const connection = {close: vi.fn().mockResolvedValue(undefined)};
    const firstWorker = temporalWorker(Promise.resolve());
    mocks.createTemporalWorkerConnection.mockResolvedValue(connection);
    mocks.createTemporalWorker.mockResolvedValueOnce(firstWorker).mockRejectedValueOnce(failure);

    const result = startModuleWorkers({
      workers: [moduleWorker({taskQueue: 'first'}), moduleWorker({taskQueue: 'second'})],
    });

    await expect(result).rejects.toThrow('Failed to start module worker for task queue second');
    await result.catch((error: unknown) => {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).cause).toBe(failure);
    });
    expect(firstWorker.shutdown).toHaveBeenCalledOnce();
    expect(connection.close).toHaveBeenCalledOnce();
    expect(mocks.closeTemporalClient).toHaveBeenCalledOnce();
  });
});
