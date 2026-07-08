import type {ModuleWorker, StartModuleWorkersOptions} from '@shipfox/node-module';
import {run} from './run.js';

const mocks = vi.hoisted(() => {
  const metricCounter = {
    add: vi.fn(),
  };
  return {
    captureException: vi.fn(),
    closeApp: vi.fn(),
    closeErrorMonitoring: vi.fn(),
    createApp: vi.fn(),
    createDefinitionsModule: vi.fn(),
    createE2eAdminAuthMethod: vi.fn(),
    createE2eRouteGroup: vi.fn(),
    createIntegrationsContext: vi.fn(),
    buildAgentToolCatalogs: vi.fn(),
    buildAgentToolSelectionCatalogs: vi.fn(),
    createWorkspaceConnectionSnapshotLoader: vi.fn(),
    getIntegrationConnectionById: vi.fn(),
    createPostgresClient: vi.fn(),
    createProjectsModule: vi.fn(),
    deleteSecrets: vi.fn(),
    getSecret: vi.fn(),
    setSecrets: vi.fn(),
    apiConfig: {
      API_PORT: undefined as number | undefined,
      API_TRUST_PROXY: 'false',
      E2E_ENABLED: false,
    },
    initializeModules: vi.fn(),
    listen: vi.fn(),
    logger: {
      error: vi.fn(),
      info: vi.fn(),
    },
    metricCounter,
    metricMeter: {
      createCounter: vi.fn(() => metricCounter),
    },
    parseApiTrustProxy: vi.fn(),
    registerModuleMetrics: vi.fn(),
    setAgentToolMaterializationServices: vi.fn(),
    setSourceControl: vi.fn(),
    loadRunningLeasedStep: vi.fn(),
    startModuleWorkers: vi.fn(),
    startServiceMetrics: vi.fn(),
  };
});

vi.mock('@shipfox/api-agent', () => ({agentModule: {name: 'agent'}}));
vi.mock('@shipfox/annotations', () => ({annotationsModule: {name: 'annotations'}}));
vi.mock('@shipfox/api-auth', () => ({authModule: {name: 'auth'}}));
vi.mock('@shipfox/api-definitions', () => ({
  createDefinitionsModule: mocks.createDefinitionsModule,
}));
vi.mock('@shipfox/api-dispatcher', () => ({dispatcherModule: {name: 'dispatcher'}}));
vi.mock('@shipfox/api-integration-core', () => ({
  buildAgentToolCatalogs: mocks.buildAgentToolCatalogs,
  buildAgentToolSelectionCatalogs: mocks.buildAgentToolSelectionCatalogs,
  createIntegrationsContext: mocks.createIntegrationsContext,
  createWorkspaceConnectionSnapshotLoader: mocks.createWorkspaceConnectionSnapshotLoader,
  getIntegrationConnectionById: mocks.getIntegrationConnectionById,
}));
vi.mock('@shipfox/api-logs', () => ({logsModule: {name: 'logs'}}));
vi.mock('@shipfox/api-projects', () => ({createProjectsModule: mocks.createProjectsModule}));
vi.mock('@shipfox/api-runners', () => ({runnersModule: {name: 'runners'}}));
vi.mock('@shipfox/api-secrets', () => ({
  deleteSecrets: mocks.deleteSecrets,
  getSecret: mocks.getSecret,
  secretsModule: {name: 'secrets'},
  setSecrets: mocks.setSecrets,
}));
vi.mock('@shipfox/api-triggers', () => ({triggersModule: {name: 'triggers'}}));
vi.mock('@shipfox/api-workflows', () => ({
  loadRunningLeasedStep: mocks.loadRunningLeasedStep,
  setAgentToolMaterializationServices: mocks.setAgentToolMaterializationServices,
  setSourceControl: mocks.setSourceControl,
  workflowsModule: {name: 'workflows'},
}));
vi.mock('@shipfox/api-workspaces', () => ({workspacesModule: {name: 'workspaces'}}));
vi.mock('@shipfox/node-error-monitoring', () => ({
  captureException: mocks.captureException,
  closeErrorMonitoring: mocks.closeErrorMonitoring,
}));
vi.mock('@shipfox/node-fastify', () => ({
  closeApp: mocks.closeApp,
  createApp: mocks.createApp,
  defineRoute: (route: unknown) => route,
  listen: mocks.listen,
}));
vi.mock('@shipfox/node-module', () => ({
  initializeModules: mocks.initializeModules,
  registerModuleMetrics: mocks.registerModuleMetrics,
  startModuleWorkers: mocks.startModuleWorkers,
}));
vi.mock('@shipfox/node-opentelemetry', () => ({
  instanceMetrics: {getMeter: () => mocks.metricMeter},
  logger: () => mocks.logger,
  startServiceMetrics: mocks.startServiceMetrics,
}));
vi.mock('@shipfox/node-postgres', () => ({createPostgresClient: mocks.createPostgresClient}));
vi.mock('../config.js', () => ({
  config: mocks.apiConfig,
  parseApiTrustProxy: mocks.parseApiTrustProxy,
}));
vi.mock('./e2e.js', () => ({
  createE2eAdminAuthMethod: mocks.createE2eAdminAuthMethod,
  createE2eRouteGroup: mocks.createE2eRouteGroup,
}));

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

describe('run', () => {
  beforeEach(() => {
    vi.useRealTimers();
    mocks.captureException.mockReset();
    mocks.closeApp.mockReset();
    mocks.closeErrorMonitoring.mockReset();
    mocks.createApp.mockReset();
    mocks.createDefinitionsModule.mockReset();
    mocks.createE2eAdminAuthMethod.mockReset();
    mocks.createE2eRouteGroup.mockReset();
    mocks.createIntegrationsContext.mockReset();
    mocks.buildAgentToolCatalogs.mockReset();
    mocks.buildAgentToolSelectionCatalogs.mockReset();
    mocks.createWorkspaceConnectionSnapshotLoader.mockReset();
    mocks.getIntegrationConnectionById.mockReset();
    mocks.createPostgresClient.mockReset();
    mocks.createProjectsModule.mockReset();
    mocks.deleteSecrets.mockReset();
    mocks.getSecret.mockReset();
    mocks.setSecrets.mockReset();
    mocks.apiConfig.API_PORT = undefined;
    mocks.apiConfig.API_TRUST_PROXY = 'false';
    mocks.apiConfig.E2E_ENABLED = false;
    mocks.initializeModules.mockReset();
    mocks.listen.mockReset();
    mocks.logger.error.mockReset();
    mocks.logger.info.mockReset();
    mocks.metricCounter.add.mockReset();
    mocks.metricMeter.createCounter.mockReset();
    mocks.parseApiTrustProxy.mockReset();
    mocks.registerModuleMetrics.mockReset();
    mocks.setAgentToolMaterializationServices.mockReset();
    mocks.setSourceControl.mockReset();
    mocks.loadRunningLeasedStep.mockReset();
    mocks.startModuleWorkers.mockReset();
    mocks.startServiceMetrics.mockReset();

    mocks.createIntegrationsContext.mockResolvedValue({
      module: {name: 'integrations'},
      registry: {},
      runStartupTasks: vi.fn().mockResolvedValue(undefined),
      sourceControl: {},
    });
    mocks.buildAgentToolCatalogs.mockResolvedValue(new Map());
    mocks.buildAgentToolSelectionCatalogs.mockResolvedValue(new Map());
    mocks.createWorkspaceConnectionSnapshotLoader.mockReturnValue(vi.fn());
    mocks.createProjectsModule.mockReturnValue({name: 'projects'});
    mocks.createDefinitionsModule.mockReturnValue({name: 'definitions'});
    mocks.initializeModules.mockResolvedValue({
      auth: [],
      routes: [],
      e2eRoutes: [],
      workers: [worker()],
    });
    mocks.createE2eRouteGroup.mockReturnValue([]);
    mocks.createApp.mockResolvedValue({});
    mocks.parseApiTrustProxy.mockReturnValue(false);
    mocks.startModuleWorkers.mockResolvedValue(undefined);
    mocks.listen.mockResolvedValue('http://127.0.0.1:3000');
    mocks.closeApp.mockResolvedValue(undefined);
    mocks.closeErrorMonitoring.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('awaits module workers before listening for HTTP requests', async () => {
    let resolveWorkers: (() => void) | undefined;
    const workersStarted = new Promise<void>((resolve) => {
      mocks.startModuleWorkers.mockImplementationOnce(
        () =>
          new Promise<void>((innerResolve) => {
            resolveWorkers = innerResolve;
            resolve();
          }),
      );
    });

    const result = run();
    await workersStarted;

    expect(mocks.listen).not.toHaveBeenCalled();

    resolveWorkers?.();
    await result;

    expect(mocks.listen).toHaveBeenCalledTimes(1);
    expect(mocks.startModuleWorkers.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.listen.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('passes API_PORT to the HTTP listener when configured', async () => {
    mocks.apiConfig.API_PORT = 55_291;

    await run();

    expect(mocks.listen).toHaveBeenCalledWith({port: 55_291});
  });

  it('injects the leased-step loader into integration routes', async () => {
    await run();

    expect(mocks.createIntegrationsContext).toHaveBeenCalledWith({
      secrets: {
        deleteSecrets: mocks.deleteSecrets,
        linear: expect.objectContaining({
          deleteSecrets: expect.any(Function),
          getSecret: expect.any(Function),
          setSecrets: expect.any(Function),
        }),
      },
      agentTools: {loadLeasedAgentStep: mocks.loadRunningLeasedStep},
    });
  });

  it('does not listen when module worker startup fails', async () => {
    const failure = new Error('worker boot failed');
    mocks.startModuleWorkers.mockRejectedValueOnce(failure);

    const result = run();

    await expect(result).rejects.toBe(failure);
    expect(mocks.listen).not.toHaveBeenCalled();
  });

  it('captures runtime worker failures, closes HTTP, and exits', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    await run();
    const failure = new Error('poller failed');
    const failedWorker = worker('runtime-queue');

    const result = Promise.resolve(
      lastStartModuleWorkersOptions().onWorkerFailure?.(failure, failedWorker),
    );
    const assertion = expect(result).rejects.toThrow('exit 1');

    await assertion;
    expect(mocks.logger.error).toHaveBeenCalledWith(
      {err: failure, taskQueue: 'runtime-queue'},
      'Module worker stopped unexpectedly',
    );
    expect(mocks.captureException).toHaveBeenCalledWith(failure);
    expect(mocks.closeApp).toHaveBeenCalledTimes(1);
    expect(mocks.closeErrorMonitoring).toHaveBeenCalledWith(2_000);
    expect(mocks.closeErrorMonitoring.mock.invocationCallOrder[0]).toBeLessThan(
      exitSpy.mock.invocationCallOrder[0] ?? 0,
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mocks.closeApp.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.closeErrorMonitoring.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('exits when graceful HTTP shutdown times out after runtime worker failure', async () => {
    vi.useFakeTimers();
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    mocks.closeApp.mockReturnValueOnce(new Promise(() => undefined));
    await run();
    const failure = new Error('poller failed');

    const result = Promise.resolve(
      lastStartModuleWorkersOptions().onWorkerFailure?.(failure, worker()),
    );
    const assertion = expect(result).rejects.toThrow('exit 1');
    await vi.advanceTimersByTimeAsync(10_000);

    await assertion;
    expect(mocks.logger.error).toHaveBeenCalledWith(
      {timeoutMs: 10_000},
      'Timed out closing HTTP server after worker failure',
    );
    expect(mocks.closeErrorMonitoring).toHaveBeenCalledWith(2_000);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('flushes error monitoring when graceful HTTP shutdown rejects', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    const closeFailure = new Error('onClose failed');
    mocks.closeApp.mockRejectedValueOnce(closeFailure);
    await run();
    const failure = new Error('poller failed');

    const result = Promise.resolve(
      lastStartModuleWorkersOptions().onWorkerFailure?.(failure, worker()),
    );
    const assertion = expect(result).rejects.toThrow('exit 1');

    await assertion;
    expect(mocks.logger.error).toHaveBeenCalledWith(
      {err: closeFailure},
      'Failed to close HTTP server after worker failure',
    );
    expect(mocks.closeErrorMonitoring).toHaveBeenCalledWith(2_000);
    expect(mocks.closeErrorMonitoring.mock.invocationCallOrder[0]).toBeLessThan(
      exitSpy.mock.invocationCallOrder[0] ?? 0,
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
