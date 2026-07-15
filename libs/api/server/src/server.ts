import {captureException, closeErrorMonitoring} from '@shipfox/node-error-monitoring';
import {closeApp, createApp, listen} from '@shipfox/node-fastify';
import {
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

export interface CreateServerOptions {
  modules: ShipfoxModule[];
  onWorkerFailure?: (error: unknown, worker: ModuleWorker) => void | Promise<void>;
}

export interface ServerHandle {
  start(): Promise<string>;
  stop(): Promise<void>;
}

export async function createServer(options: CreateServerOptions): Promise<ServerHandle> {
  startServiceMetrics({serviceName: 'api'});
  createPostgresClient();

  try {
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
    let stopPromise: Promise<void> | undefined;

    return {
      async start(): Promise<string> {
        logger().info('Starting module workers');
        workersHandle = await startModuleWorkers({
          workers,
          onWorkerFailure: (error, worker) =>
            handleModuleWorkerFailure(error, worker, options.onWorkerFailure),
        });

        logger().info('Starting HTTP server');
        const address =
          config.API_PORT === undefined ? await listen() : await listen({port: config.API_PORT});
        logger().info({address}, 'HTTP server listening');
        return address;
      },
      stop: () =>
        (stopPromise ??= (async () => {
          await closeApp();
          await workersHandle?.stop();
          await shutdownServiceMetrics();
          await closePostgresClient();
          resetPublishers();
          resetSubscribers();
          await closeErrorMonitoring(ERROR_MONITORING_SHUTDOWN_TIMEOUT_MS);
        })()),
    };
  } catch (error) {
    await shutdownServiceMetrics();
    await closePostgresClient();
    resetPublishers();
    resetSubscribers();
    throw error;
  }
}

export async function runServer(options: {modules: ShipfoxModule[]}): Promise<ServerHandle> {
  const handle = await createServer({
    modules: options.modules,
    onWorkerFailure: () => process.exit(1),
  });
  try {
    await handle.start();
  } catch (error) {
    await handle.stop();
    throw error;
  }

  const stopAndExit = () => void handle.stop().finally(() => process.exit(0));
  process.once('SIGTERM', stopAndExit);
  process.once('SIGINT', stopAndExit);

  return handle;
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
