import {captureException, closeErrorMonitoring} from '@shipfox/node-error-monitoring';
import {closeApp, createApp, listen} from '@shipfox/node-fastify';
import {
  aggregateLoginMethods,
  initializeModules,
  type ModuleWorker,
  type ModuleWorkersHandle,
  registerModuleMetrics,
  resetPublishers,
  resetSubscribers,
  runModuleStartupTasks,
  type ShipfoxModule,
  startModuleWorkers,
} from '@shipfox/node-module';
import {logger, shutdownServiceMetrics, startServiceMetrics} from '@shipfox/node-opentelemetry';
import {closePostgresClient, createPostgresClient} from '@shipfox/node-postgres';
import {config, parseApiTrustProxy} from './config.js';
import {createE2eAdminAuthMethod, createE2eRouteGroup} from './e2e.js';

const WORKER_FAILURE_HTTP_SHUTDOWN_TIMEOUT_MS = 10_000;
const ERROR_MONITORING_SHUTDOWN_TIMEOUT_MS = 2_000;

let hasActiveServer = false;

export interface CreateServerOptions {
  modules: ShipfoxModule[];
  onWorkerFailure?: (error: unknown, worker: ModuleWorker) => void | Promise<void>;
}

export interface ServerHandle {
  start(): Promise<string>;
  stop(): Promise<void>;
}

export interface RunServerOptions {
  modules: ShipfoxModule[];
  onStartupFailure?: (error: unknown) => void | Promise<void>;
}

export async function createServer(options: CreateServerOptions): Promise<ServerHandle> {
  if (hasActiveServer) {
    throw new Error('Cannot create a second API server before the existing server stops');
  }
  hasActiveServer = true;

  try {
    aggregateLoginMethods({modules: options.modules});
    startServiceMetrics({serviceName: 'api'});
    createPostgresClient();

    const {auth, routes, e2eRoutes, workers} = await initializeModules({modules: options.modules});
    registerModuleMetrics({modules: options.modules});
    await runModuleStartupTasks({modules: options.modules});

    const e2eAuth = config.E2E_ENABLED ? [createE2eAdminAuthMethod(config)] : [];
    const mountedE2eRoutes = createE2eRouteGroup(e2eRoutes, config);

    logger().info('Creating HTTP server');
    await createApp({
      auth: [...auth, ...e2eAuth],
      routes: [...routes, ...mountedE2eRoutes],
      fastifyOptions: {trustProxy: parseApiTrustProxy(config.API_TRUST_PROXY)},
    });

    let workersHandle: ModuleWorkersHandle | undefined;
    let startPromise: Promise<string> | undefined;
    let stopPromise: Promise<void> | undefined;
    let stopped = false;

    const start = (): Promise<string> => {
      if (stopPromise || stopped)
        return Promise.reject(new Error('Cannot start a stopped API server'));

      startPromise ??= (async () => {
        logger().info('Starting module workers');
        workersHandle = await startModuleWorkers({
          workers,
          onWorkerFailure: (error, worker) =>
            handleModuleWorkerFailure(error, worker, options.onWorkerFailure),
        });

        if (stopPromise) throw new Error('API server stopped during startup');

        logger().info('Starting HTTP server');
        const address =
          config.API_PORT === undefined ? await listen() : await listen({port: config.API_PORT});
        logger().info({address}, 'HTTP server listening');
        return address;
      })();
      return startPromise;
    };

    const stop = (): Promise<void> => {
      if (stopped) return Promise.resolve();

      stopPromise ??= (async () => {
        try {
          await startPromise?.catch(() => undefined);
          const cleanupErrors = await runCleanupSteps([
            () => closeApp(),
            () => workersHandle?.stop(),
            () => shutdownServiceMetrics(),
            () => closePostgresClient(),
            () => resetPublishers(),
            () => resetSubscribers(),
            () => closeErrorMonitoring(ERROR_MONITORING_SHUTDOWN_TIMEOUT_MS),
          ]);
          throwCleanupErrors(cleanupErrors, 'Failed to stop API server');
          stopped = true;
          hasActiveServer = false;
        } finally {
          stopPromise = undefined;
        }
      })();
      return stopPromise;
    };

    return {start, stop};
  } catch (error) {
    const cleanupErrors = await runCleanupSteps([
      () => shutdownServiceMetrics(),
      () => closePostgresClient(),
      () => resetPublishers(),
      () => resetSubscribers(),
    ]);
    for (const cleanupError of cleanupErrors) {
      logger().error({err: cleanupError, bootError: error}, 'Failed to clean up API server boot');
    }
    hasActiveServer = false;
    throw error;
  }
}

export async function runServer(options: RunServerOptions): Promise<ServerHandle> {
  let handle: ServerHandle;
  try {
    handle = await createServer({
      modules: options.modules,
      onWorkerFailure: () => process.exit(1),
    });
  } catch (error) {
    await reportStartupFailure(error, options.onStartupFailure);
    throw error;
  }

  try {
    await handle.start();
  } catch (error) {
    await reportStartupFailure(error, options.onStartupFailure);
    try {
      await handle.stop();
    } catch (cleanupError) {
      logger().error(
        {err: cleanupError, startError: error},
        'Failed to clean up API server startup',
      );
    }
    throw error;
  }

  const stopAndExit = () => void handle.stop().finally(() => process.exit(0));
  process.once('SIGTERM', stopAndExit);
  process.once('SIGINT', stopAndExit);

  return handle;
}

async function reportStartupFailure(
  error: unknown,
  onStartupFailure: RunServerOptions['onStartupFailure'],
): Promise<void> {
  try {
    await onStartupFailure?.(error);
  } catch (reportingError) {
    logger().error(
      {err: reportingError, startError: error},
      'Failed to report API server startup error',
    );
  }
}

type CleanupStep = () => void | Promise<void>;

async function runCleanupSteps(steps: CleanupStep[]): Promise<unknown[]> {
  const cleanupErrors: unknown[] = [];
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  return cleanupErrors;
}

function throwCleanupErrors(cleanupErrors: unknown[], message: string): void {
  if (cleanupErrors.length === 0) return;
  if (cleanupErrors.length === 1) throw cleanupErrors[0];
  throw new AggregateError(cleanupErrors, message);
}

async function handleModuleWorkerFailure(
  error: unknown,
  worker: ModuleWorker,
  onWorkerFailure: CreateServerOptions['onWorkerFailure'],
): Promise<void> {
  logger().error({err: error, taskQueue: worker.taskQueue}, 'Module worker stopped unexpectedly');
  captureException(error);

  try {
    await closeHttpServerAfterWorkerFailure();
    await closeErrorMonitoring(ERROR_MONITORING_SHUTDOWN_TIMEOUT_MS);
  } finally {
    await onWorkerFailure?.(error, worker);
  }
}

async function closeHttpServerAfterWorkerFailure(): Promise<void> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timeoutId = setTimeout(() => resolve('timeout'), WORKER_FAILURE_HTTP_SHUTDOWN_TIMEOUT_MS);
  });
  try {
    const result = await Promise.race([closeApp().then(() => 'closed' as const), timeout]).finally(
      () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      },
    );
    if (result === 'timeout') {
      logger().error(
        {timeoutMs: WORKER_FAILURE_HTTP_SHUTDOWN_TIMEOUT_MS},
        'Timed out closing HTTP server after worker failure',
      );
    }
  } catch (error) {
    logger().error({err: error}, 'Failed to close HTTP server after worker failure');
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
