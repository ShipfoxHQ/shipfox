import type {NativeConnection} from '@temporalio/worker';
import type {CreateWorkerOptions} from './worker.js';
import {
  bundleProductionWorkflow,
  createTemporalWorker,
  createTemporalWorkerConnection,
  productionWorkflowBundlerOptions,
} from './worker.js';

const mocks = vi.hoisted(() => ({
  bundleWorkflowCode: vi.fn(),
  nativeConnectionConnect: vi.fn(),
  workerCreate: vi.fn(),
  logger: {info: vi.fn()},
  getTemporalConnectionOptions: vi.fn(),
  temporalConnectionError: vi.fn(),
  temporalConfig: {
    TEMPORAL_NAMESPACE: 'test-namespace',
    TEMPORAL_TASK_QUEUE: 'test-queue',
  },
}));

vi.mock('@temporalio/worker', () => ({
  bundleWorkflowCode: mocks.bundleWorkflowCode,
  NativeConnection: {connect: mocks.nativeConnectionConnect},
  Worker: {create: mocks.workerCreate},
}));

vi.mock('@shipfox/node-opentelemetry', () => ({
  logger: () => mocks.logger,
}));

vi.mock('./connection-options.js', () => ({
  getTemporalConnectionOptions: mocks.getTemporalConnectionOptions,
  temporalConnectionError: mocks.temporalConnectionError,
}));

vi.mock('./config.js', () => ({config: mocks.temporalConfig}));

function workerOptions(overrides: Partial<CreateWorkerOptions> = {}): CreateWorkerOptions {
  return {
    workflowsPath: '/tmp/workflows.js',
    activities: {},
    ...overrides,
  };
}

describe('createTemporalWorkerConnection', () => {
  beforeEach(() => {
    mocks.nativeConnectionConnect.mockReset();
    mocks.getTemporalConnectionOptions.mockReset();
    mocks.temporalConnectionError.mockReset();
    mocks.getTemporalConnectionOptions.mockReturnValue({address: 'temporal.example.test:7233'});
    mocks.temporalConnectionError.mockImplementation(
      (error) => new Error('Failed to connect to Temporal.', {cause: error}),
    );
  });

  it('connects with the configured Temporal connection options', async () => {
    const connection = {};
    mocks.nativeConnectionConnect.mockResolvedValue(connection);

    const result = await createTemporalWorkerConnection();

    expect(result).toBe(connection);
    expect(mocks.nativeConnectionConnect).toHaveBeenCalledWith({
      address: 'temporal.example.test:7233',
    });
  });

  it('translates connection failures', async () => {
    const failure = new Error('connection refused');
    mocks.nativeConnectionConnect.mockRejectedValue(failure);

    const result = createTemporalWorkerConnection();

    await expect(result).rejects.toThrow('Failed to connect to Temporal.');
    await result.catch((error: unknown) => {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).cause).toBe(failure);
    });
  });
});

describe('createTemporalWorker', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    mocks.bundleWorkflowCode.mockReset();
    mocks.nativeConnectionConnect.mockReset();
    mocks.workerCreate.mockReset();
    mocks.logger.info.mockReset();
    mocks.getTemporalConnectionOptions.mockReset();
    mocks.temporalConnectionError.mockReset();
    mocks.nativeConnectionConnect.mockResolvedValue({});
    mocks.workerCreate.mockResolvedValue({});
    mocks.getTemporalConnectionOptions.mockReturnValue({address: 'temporal.example.test:7233'});
  });

  it('creates a connection when one is not provided', async () => {
    const connection = {};
    mocks.nativeConnectionConnect.mockResolvedValue(connection);

    await createTemporalWorker(workerOptions());

    expect(mocks.workerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        connection,
        namespace: 'test-namespace',
        taskQueue: 'test-queue',
      }),
    );
  });

  it('uses a caller-owned connection without creating or closing one', async () => {
    const connection = {close: vi.fn()} as unknown as NativeConnection;
    const worker = {shutdown: vi.fn()};
    mocks.workerCreate.mockResolvedValue(worker);

    const result = await createTemporalWorker(workerOptions({connection}));
    await result.shutdown();

    expect(mocks.nativeConnectionConnect).not.toHaveBeenCalled();
    expect(mocks.workerCreate).toHaveBeenCalledWith(expect.objectContaining({connection}));
    expect(connection.close).not.toHaveBeenCalled();
  });

  it('keeps workspace development workflow resolution unchanged', async () => {
    vi.stubEnv('NODE_ENV', 'development');

    await createTemporalWorker(workerOptions());

    expect(mocks.workerCreate).toHaveBeenCalledWith(
      expect.not.objectContaining({bundlerOptions: expect.anything()}),
    );
  });

  it('uses production workflow resolution in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    await createTemporalWorker(workerOptions());

    expect(mocks.workerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        bundlerOptions: expect.objectContaining({webpackConfigHook: expect.any(Function)}),
      }),
    );
  });
});

describe('productionWorkflowBundlerOptions', () => {
  it('uses production conditions without replacing Temporal resolution settings', () => {
    const extensions = ['.ts', '.js'];
    const extensionAlias = {'.js': ['.ts', '.js']};
    const webpackConfig = {resolve: {extensions, extensionAlias}};

    const result = productionWorkflowBundlerOptions().webpackConfigHook?.(webpackConfig);

    expect(result?.resolve).toEqual(
      expect.objectContaining({
        extensions,
        extensionAlias,
        conditionNames: expect.arrayContaining(['webpack', 'production', 'node', 'import']),
      }),
    );
    expect(result?.resolve?.conditionNames).not.toContain('development');
    expect(result?.resolve?.conditionNames).not.toContain('workspace-source');
  });
});

describe('bundleProductionWorkflow', () => {
  it('uses the same production bundler options as a production worker', async () => {
    mocks.bundleWorkflowCode.mockResolvedValue({code: 'workflow bundle'});

    await bundleProductionWorkflow('/tmp/workflows.js');

    expect(mocks.bundleWorkflowCode).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowsPath: '/tmp/workflows.js',
        webpackConfigHook: expect.any(Function),
      }),
    );
  });
});
