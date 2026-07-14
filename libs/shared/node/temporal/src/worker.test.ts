import type {NativeConnection} from '@temporalio/worker';
import type {CreateWorkerOptions} from './worker.js';
import {createTemporalWorker, createTemporalWorkerConnection} from './worker.js';

const mocks = vi.hoisted(() => ({
  nativeConnectionConnect: vi.fn(),
  workerCreate: vi.fn(),
  logger: {info: vi.fn()},
  getTemporalConnectionOptions: vi.fn(),
  temporalConnectionError: vi.fn(),
}));

vi.mock('@temporalio/worker', () => ({
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
      expect.objectContaining({connection, taskQueue: 'shipfox'}),
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
});
