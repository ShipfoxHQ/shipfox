import {registerModuleMetrics, startModuleWorkers} from './initialize.js';
import type {ModuleWorker, ShipfoxModule} from './types.js';

const mocks = vi.hoisted(() => ({
  createTemporalClient: vi.fn(),
  createTemporalWorker: vi.fn(),
  workflowStart: vi.fn(),
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@shipfox/node-temporal', () => ({
  createTemporalClient: mocks.createTemporalClient,
  createTemporalWorker: mocks.createTemporalWorker,
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
    mocks.createTemporalClient.mockReset();
    mocks.createTemporalWorker.mockReset();
    mocks.workflowStart.mockReset();
    mocks.logger.error.mockReset();
    mocks.logger.info.mockReset();
    mocks.createTemporalClient.mockResolvedValue({});
    mocks.createTemporalWorker.mockResolvedValue(temporalWorker());
    mocks.workflowStart.mockResolvedValue({});
  });

  it('does not create a Temporal client when no workers are declared', async () => {
    await startModuleWorkers({workers: []});

    expect(mocks.createTemporalClient).not.toHaveBeenCalled();
  });

  it('rejects when Temporal client creation fails', async () => {
    const failure = new Error('temporal unavailable');
    mocks.createTemporalClient.mockRejectedValueOnce(failure);

    const result = startModuleWorkers({workers: [moduleWorker()]});

    await expect(result).rejects.toBe(failure);
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
    mocks.workflowStart.mockRejectedValueOnce(failure);

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

  it('identifies the failing task queue when a later worker fails to start', async () => {
    const failure = new Error('second worker missing');
    mocks.createTemporalWorker
      .mockResolvedValueOnce(temporalWorker())
      .mockRejectedValueOnce(failure);

    const result = startModuleWorkers({
      workers: [moduleWorker({taskQueue: 'first'}), moduleWorker({taskQueue: 'second'})],
    });

    await expect(result).rejects.toThrow('Failed to start module worker for task queue second');
    await result.catch((error: unknown) => {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).cause).toBe(failure);
    });
  });
});
