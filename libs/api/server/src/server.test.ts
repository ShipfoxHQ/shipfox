import type {
  ModuleWorker,
  ModuleWorkersHandle,
  ShipfoxModule,
  StartModuleWorkersOptions,
} from '@shipfox/node-module';
import {createServer, runServer} from './server.js';

const mocks = vi.hoisted(() => {
  const workersHandle = {stop: vi.fn()};
  return {
    captureException: vi.fn(),
    closeApp: vi.fn(),
    closeErrorMonitoring: vi.fn(),
    closePostgresClient: vi.fn(),
    createApp: vi.fn(),
    createE2eAdminAuthMethod: vi.fn(),
    createE2eRouteGroup: vi.fn(),
    createPostgresClient: vi.fn(),
    initializeModules: vi.fn(),
    listen: vi.fn(),
    logger: {error: vi.fn(), info: vi.fn()},
    parseApiTrustProxy: vi.fn(),
    registerModuleMetrics: vi.fn(),
    resetPublishers: vi.fn(),
    resetSubscribers: vi.fn(),
    runModuleStartupTasks: vi.fn(),
    shutdownServiceMetrics: vi.fn(),
    startModuleWorkers: vi.fn(),
    startServiceMetrics: vi.fn(),
    workersHandle,
    apiConfig: {
      API_PORT: undefined as number | undefined,
      API_TRUST_PROXY: 'false',
      E2E_ENABLED: false,
    },
  };
});

vi.mock('@shipfox/node-error-monitoring', () => ({
  captureException: mocks.captureException,
  closeErrorMonitoring: mocks.closeErrorMonitoring,
}));
vi.mock('@shipfox/node-fastify', () => ({
  closeApp: mocks.closeApp,
  createApp: mocks.createApp,
  listen: mocks.listen,
}));
vi.mock('@shipfox/node-module', () => ({
  initializeModules: mocks.initializeModules,
  registerModuleMetrics: mocks.registerModuleMetrics,
  resetPublishers: mocks.resetPublishers,
  resetSubscribers: mocks.resetSubscribers,
  runModuleStartupTasks: mocks.runModuleStartupTasks,
  startModuleWorkers: mocks.startModuleWorkers,
}));
vi.mock('@shipfox/node-opentelemetry', () => ({
  logger: () => mocks.logger,
  shutdownServiceMetrics: mocks.shutdownServiceMetrics,
  startServiceMetrics: mocks.startServiceMetrics,
}));
vi.mock('@shipfox/node-postgres', () => ({
  closePostgresClient: mocks.closePostgresClient,
  createPostgresClient: mocks.createPostgresClient,
}));
vi.mock('./config.js', () => ({
  config: mocks.apiConfig,
  parseApiTrustProxy: mocks.parseApiTrustProxy,
}));
vi.mock('./e2e.js', () => ({
  createE2eAdminAuthMethod: mocks.createE2eAdminAuthMethod,
  createE2eRouteGroup: mocks.createE2eRouteGroup,
}));

function module(): ShipfoxModule {
  return {name: 'test'};
}

function worker(taskQueue = 'runtime-queue'): ModuleWorker {
  return {
    taskQueue,
    workflowsPath: '/tmp/workflows.js',
    activities: () => ({}),
    workflows: [],
  };
}

function lastStartModuleWorkersOptions(): StartModuleWorkersOptions {
  const options = mocks.startModuleWorkers.mock.calls.at(-1)?.[0];
  if (!options) throw new Error('startModuleWorkers was not called');
  return options as StartModuleWorkersOptions;
}

function resetMocks(): void {
  vi.useRealTimers();
  mocks.captureException.mockReset();
  mocks.closeApp.mockReset();
  mocks.closeErrorMonitoring.mockReset();
  mocks.closePostgresClient.mockReset();
  mocks.createApp.mockReset();
  mocks.createE2eAdminAuthMethod.mockReset();
  mocks.createE2eRouteGroup.mockReset();
  mocks.createPostgresClient.mockReset();
  mocks.initializeModules.mockReset();
  mocks.listen.mockReset();
  mocks.logger.error.mockReset();
  mocks.logger.info.mockReset();
  mocks.parseApiTrustProxy.mockReset();
  mocks.registerModuleMetrics.mockReset();
  mocks.resetPublishers.mockReset();
  mocks.resetSubscribers.mockReset();
  mocks.runModuleStartupTasks.mockReset();
  mocks.shutdownServiceMetrics.mockReset();
  mocks.startModuleWorkers.mockReset();
  mocks.startServiceMetrics.mockReset();
  mocks.workersHandle.stop.mockReset();
  mocks.apiConfig.API_PORT = undefined;
  mocks.apiConfig.API_TRUST_PROXY = 'false';
  mocks.apiConfig.E2E_ENABLED = false;

  mocks.closeApp.mockResolvedValue(undefined);
  mocks.closeErrorMonitoring.mockResolvedValue(true);
  mocks.closePostgresClient.mockResolvedValue(undefined);
  mocks.createApp.mockResolvedValue({});
  mocks.createE2eRouteGroup.mockReturnValue([]);
  mocks.initializeModules.mockResolvedValue({
    auth: [],
    routes: [],
    e2eRoutes: [],
    workers: [worker()],
  });
  mocks.listen.mockResolvedValue('http://127.0.0.1:3000');
  mocks.parseApiTrustProxy.mockReturnValue(false);
  mocks.runModuleStartupTasks.mockResolvedValue(undefined);
  mocks.shutdownServiceMetrics.mockResolvedValue(undefined);
  mocks.startModuleWorkers.mockResolvedValue(mocks.workersHandle);
  mocks.workersHandle.stop.mockResolvedValue(undefined);
}

describe('createServer', () => {
  beforeEach(resetMocks);

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('initializes modules, metrics, startup tasks, and the HTTP app', async () => {
    const modules = [module()];

    await createServer({modules});

    expect(mocks.startServiceMetrics).toHaveBeenCalledWith({serviceName: 'api'});
    expect(mocks.createPostgresClient).toHaveBeenCalledOnce();
    expect(mocks.initializeModules).toHaveBeenCalledWith({modules});
    expect(mocks.registerModuleMetrics).toHaveBeenCalledWith({modules});
    expect(mocks.runModuleStartupTasks).toHaveBeenCalledWith({modules});
    expect(mocks.createApp).toHaveBeenCalledWith({
      auth: [],
      routes: [],
      fastifyOptions: {trustProxy: false},
    });
  });

  it('starts module workers before listening for HTTP requests', async () => {
    const server = await createServer({modules: [module()]});
    let resolveWorkers: ((handle: ModuleWorkersHandle) => void) | undefined;
    const workersStarted = new Promise<void>((resolve) => {
      mocks.startModuleWorkers.mockImplementationOnce(
        () =>
          new Promise<ModuleWorkersHandle>((innerResolve) => {
            resolveWorkers = innerResolve;
            resolve();
          }),
      );
    });

    const start = server.start();
    await workersStarted;

    expect(mocks.listen).not.toHaveBeenCalled();

    resolveWorkers?.(mocks.workersHandle);
    await start;

    expect(mocks.startModuleWorkers.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.listen.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('passes API_PORT to the HTTP listener when configured', async () => {
    mocks.apiConfig.API_PORT = 55_291;
    const server = await createServer({modules: [module()]});

    await server.start();

    expect(mocks.listen).toHaveBeenCalledWith({port: 55_291});
  });

  it('does not listen when module worker startup fails', async () => {
    const failure = new Error('worker boot failed');
    mocks.startModuleWorkers.mockRejectedValueOnce(failure);
    const server = await createServer({modules: [module()]});

    const result = server.start();

    await expect(result).rejects.toBe(failure);
    expect(mocks.listen).not.toHaveBeenCalled();
  });

  it('releases service metrics and Postgres when boot fails', async () => {
    const failure = new Error('migration failed');
    mocks.initializeModules.mockRejectedValueOnce(failure);

    const result = createServer({modules: [module()]});

    await expect(result).rejects.toBe(failure);
    expect(mocks.shutdownServiceMetrics.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.closePostgresClient.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mocks.resetPublishers).toHaveBeenCalledOnce();
    expect(mocks.resetSubscribers).toHaveBeenCalledOnce();
  });

  it('stops once when stop is called twice', async () => {
    const server = await createServer({modules: [module()]});
    await server.start();

    const firstStop = server.stop();
    const secondStop = server.stop();
    await firstStop;
    await secondStop;

    expect(mocks.closeApp).toHaveBeenCalledOnce();
    expect(mocks.workersHandle.stop).toHaveBeenCalledOnce();
    expect(mocks.shutdownServiceMetrics).toHaveBeenCalledOnce();
    expect(mocks.closePostgresClient).toHaveBeenCalledOnce();
    expect(mocks.resetPublishers).toHaveBeenCalledOnce();
    expect(mocks.resetSubscribers).toHaveBeenCalledOnce();
    expect(mocks.closeErrorMonitoring).toHaveBeenCalledWith(2_000);
  });

  it('stops before workers start', async () => {
    const server = await createServer({modules: [module()]});

    await server.stop();

    expect(mocks.closeApp).toHaveBeenCalledOnce();
    expect(mocks.workersHandle.stop).not.toHaveBeenCalled();
    expect(mocks.shutdownServiceMetrics).toHaveBeenCalledOnce();
    expect(mocks.closePostgresClient).toHaveBeenCalledOnce();
    expect(mocks.resetPublishers).toHaveBeenCalledOnce();
    expect(mocks.resetSubscribers).toHaveBeenCalledOnce();
  });

  it('stops resources in lifecycle order', async () => {
    const server = await createServer({modules: [module()]});
    await server.start();

    await server.stop();

    expect(mocks.closeApp.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.workersHandle.stop.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mocks.workersHandle.stop.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.shutdownServiceMetrics.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mocks.shutdownServiceMetrics.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.closePostgresClient.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mocks.closePostgresClient.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.resetPublishers.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mocks.resetSubscribers.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.closeErrorMonitoring.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('reports worker failures after closing HTTP and error monitoring', async () => {
    const onWorkerFailure = vi.fn();
    const server = await createServer({modules: [module()], onWorkerFailure});
    await server.start();
    const failure = new Error('poller failed');
    const failedWorker = worker();

    await lastStartModuleWorkersOptions().onWorkerFailure?.(failure, failedWorker);

    expect(mocks.logger.error).toHaveBeenCalledWith(
      {err: failure, taskQueue: 'runtime-queue'},
      'Module worker stopped unexpectedly',
    );
    expect(mocks.captureException).toHaveBeenCalledWith(failure);
    expect(mocks.closeApp).toHaveBeenCalledOnce();
    expect(mocks.closeErrorMonitoring).toHaveBeenCalledWith(2_000);
    expect(mocks.closeErrorMonitoring.mock.invocationCallOrder[0]).toBeLessThan(
      onWorkerFailure.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('reports a timed-out HTTP close before invoking the worker failure hook', async () => {
    vi.useFakeTimers();
    const onWorkerFailure = vi.fn();
    mocks.closeApp.mockReturnValueOnce(new Promise(() => undefined));
    const server = await createServer({modules: [module()], onWorkerFailure});
    await server.start();

    const failure = new Error('poller failed');
    const result = Promise.resolve(
      lastStartModuleWorkersOptions().onWorkerFailure?.(failure, worker()),
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await result;

    expect(mocks.logger.error).toHaveBeenCalledWith(
      {timeoutMs: 10_000},
      'Timed out closing HTTP server after worker failure',
    );
    expect(onWorkerFailure).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({taskQueue: 'runtime-queue'}),
    );
  });

  it('flushes error monitoring when HTTP close rejects', async () => {
    const onWorkerFailure = vi.fn();
    const closeFailure = new Error('onClose failed');
    mocks.closeApp.mockRejectedValueOnce(closeFailure);
    const server = await createServer({modules: [module()], onWorkerFailure});
    await server.start();

    await lastStartModuleWorkersOptions().onWorkerFailure?.(new Error('poller failed'), worker());

    expect(mocks.logger.error).toHaveBeenCalledWith(
      {err: closeFailure},
      'Failed to close HTTP server after worker failure',
    );
    expect(mocks.closeErrorMonitoring).toHaveBeenCalledWith(2_000);
    expect(mocks.closeErrorMonitoring.mock.invocationCallOrder[0]).toBeLessThan(
      onWorkerFailure.mock.invocationCallOrder[0] ?? 0,
    );
  });
});

describe('runServer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('releases its server when startup fails', async () => {
    const failure = new Error('listener unavailable');
    mocks.listen.mockRejectedValueOnce(failure);

    const result = runServer({modules: [module()]});

    await expect(result).rejects.toBe(failure);
    expect(mocks.closeApp).toHaveBeenCalledOnce();
    expect(mocks.workersHandle.stop).toHaveBeenCalledOnce();
    expect(mocks.shutdownServiceMetrics).toHaveBeenCalledOnce();
    expect(mocks.closePostgresClient).toHaveBeenCalledOnce();
    expect(mocks.resetPublishers).toHaveBeenCalledOnce();
    expect(mocks.resetSubscribers).toHaveBeenCalledOnce();
  });

  it('installs SIGTERM and SIGINT handlers that stop before exiting successfully', async () => {
    const handlers = new Map<string, () => void>();
    const onceSpy = vi.spyOn(process, 'once').mockImplementation(((
      signal: NodeJS.Signals,
      listener: () => void,
    ) => {
      handlers.set(signal, listener as () => void);
      return process;
    }) as never);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const handle = await runServer({modules: [module()]});

    expect(onceSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    expect(onceSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));

    handlers.get('SIGTERM')?.();
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(0));

    expect(mocks.closeApp.mock.invocationCallOrder[0]).toBeLessThan(
      exitSpy.mock.invocationCallOrder[0] ?? 0,
    );
    await handle.stop();
  });

  it('exits unsuccessfully when a module worker fails', async () => {
    vi.spyOn(process, 'once').mockImplementation((() => process) as never);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    await runServer({modules: [module()]});

    await lastStartModuleWorkersOptions().onWorkerFailure?.(new Error('poller failed'), worker());

    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
