const mocks = vi.hoisted(() => ({
  captureException: vi.fn(),
  closeErrorMonitoring: vi.fn(),
  logger: {
    error: vi.fn(),
  },
  defaultModules: vi.fn(),
  runServer: vi.fn(),
}));

vi.mock('@shipfox/api-server', () => ({
  defaultModules: mocks.defaultModules,
  runServer: mocks.runServer,
}));

vi.mock('@shipfox/node-error-monitoring', () => ({
  captureException: mocks.captureException,
  closeErrorMonitoring: mocks.closeErrorMonitoring,
}));

vi.mock('@shipfox/node-opentelemetry', () => ({
  logger: () => mocks.logger,
}));

describe('index', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.captureException.mockReset();
    mocks.closeErrorMonitoring.mockReset();
    mocks.logger.error.mockReset();
    mocks.defaultModules.mockReset();
    mocks.runServer.mockReset();
    mocks.closeErrorMonitoring.mockResolvedValue(true);
    mocks.defaultModules.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports runServer startup failures before flushing error monitoring', async () => {
    const failure = new Error('worker boot failed');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    mocks.runServer.mockImplementationOnce(
      async ({onStartupFailure}: {onStartupFailure?: (error: unknown) => void | Promise<void>}) => {
        await onStartupFailure?.(failure);
        throw failure;
      },
    );

    const result = import('./index.js');

    await expect(result).rejects.toThrow('exit 1');
    expect(mocks.logger.error).toHaveBeenCalledWith({error: failure}, 'Fatal startup error');
    expect(mocks.captureException).toHaveBeenCalledOnce();
    expect(mocks.captureException).toHaveBeenCalledWith(failure);
    expect(mocks.closeErrorMonitoring).toHaveBeenCalledWith(2_000);
    expect(mocks.captureException.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.closeErrorMonitoring.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mocks.closeErrorMonitoring.mock.invocationCallOrder[0]).toBeLessThan(
      exitSpy.mock.invocationCallOrder[0] ?? 0,
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
