import {runMigrations} from '@shipfox/node-drizzle';
import type {AuthMethod, RouteExport} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import {
  closeTemporalClient,
  createTemporalClient,
  createTemporalWorker,
  createTemporalWorkerConnection,
  type NativeConnection,
  temporalClient,
  type Worker,
} from '@shipfox/node-temporal';
import {registerPublisher} from './publisher-registry.js';
import {subscribe} from './registry.js';
import type {
  ModuleDatabase,
  ModuleService,
  ModuleServiceHandle,
  ModuleWorker,
  ShipfoxModule,
} from './types.js';

export interface InitializeModulesOptions {
  modules: ShipfoxModule[];
}

export interface InitializedModules {
  auth: AuthMethod[];
  routes: RouteExport[];
  e2eRoutes: RouteExport[];
  workers: ModuleWorker[];
  services: ModuleService[];
}

export interface StartModuleWorkersOptions {
  workers: ModuleWorker[];
  onWorkerFailure?: (error: unknown, worker: ModuleWorker) => void | Promise<void>;
}

export interface ModuleWorkersHandle {
  stop(): Promise<void>;
}

export interface StartModuleServicesOptions {
  services: ModuleService[];
  onServiceFailure?: (error: unknown, service: ModuleService) => void | Promise<void>;
}

export interface ModuleServicesHandle {
  stop(): Promise<void>;
}

interface StartedModuleWorker {
  worker: Worker;
  runPromise?: Promise<void>;
}

interface StartedModuleService {
  definition: ModuleService;
  handle: ModuleServiceHandle;
}

/**
 * Initializes modules in array order. Modules are processed sequentially
 * so migration order is deterministic — list modules with shared dependencies first.
 *
 * Publishers and subscribers declared on each module are registered automatically
 * into the shared pub/sub registry.
 */
export async function initializeModules(
  options: InitializeModulesOptions,
): Promise<InitializedModules> {
  const auth: AuthMethod[] = [];
  const routes: RouteExport[] = [];
  const e2eRoutes: RouteExport[] = [];
  const workers: ModuleWorker[] = [];
  const services: ModuleService[] = [];

  for (const mod of options.modules) {
    logger().info({module: mod.name}, 'Initializing module');

    if (mod.database) {
      const databases = normalizeModuleDatabases(mod.database);
      for (const [index, database] of databases.entries()) {
        logger().info({module: mod.name, database: index}, 'Running migrations');
        await runMigrations(
          database.db(),
          database.migrationsPath,
          database.migrationsTableName ?? moduleMigrationTableName(mod.name, index),
        );
        logger().info({module: mod.name, database: index}, 'Migrations complete');
      }
    }

    if (mod.publishers) {
      for (const pub of mod.publishers) {
        registerPublisher(pub);
      }
    }

    if (mod.subscribers) {
      for (const sub of mod.subscribers) {
        subscribe(sub.event, sub.handler);
      }
    }

    if (mod.auth) {
      auth.push(...mod.auth);
    }

    if (mod.routes) {
      routes.push(...mod.routes);
    }

    if (mod.e2eRoutes) {
      e2eRoutes.push(...mod.e2eRoutes);
    }

    if (mod.workers) {
      workers.push(...mod.workers);
    }

    if (mod.services) {
      services.push(...mod.services);
    }

    logger().info({module: mod.name}, 'Module initialized');
  }

  return {auth, routes, e2eRoutes, workers, services};
}

function normalizeModuleDatabases(database: ModuleDatabase | ModuleDatabase[]): ModuleDatabase[] {
  return Array.isArray(database) ? database : [database];
}

function moduleMigrationTableName(moduleName: string, index: number): string {
  if (index === 0) return `__drizzle_migrations_${moduleName}`;
  return `__drizzle_migrations_${moduleName}_${index}`;
}

/**
 * Service metrics must register after the app starts the service metrics
 * provider and initializes modules. Keeping this separate prevents tests that
 * import modules from binding the metrics port, and isolates registration
 * failures from the boot path.
 */
export function registerModuleMetrics(options: {modules: ShipfoxModule[]}): void {
  for (const mod of options.modules) {
    if (!mod.metrics) continue;
    try {
      logger().info({module: mod.name}, 'Registering module metrics');
      mod.metrics();
    } catch (error) {
      logger().warn({err: error, module: mod.name}, 'Failed to register module metrics');
    }
  }
}

export async function runModuleStartupTasks(options: {modules: ShipfoxModule[]}): Promise<void> {
  for (const mod of options.modules) {
    await mod.startupTasks?.();
  }
}

export async function startModuleServices(
  options: StartModuleServicesOptions,
): Promise<ModuleServicesHandle> {
  if (options.services.length === 0) return {stop: async () => undefined};

  const services: StartedModuleService[] = [];
  let stopping = false;
  let stopPromise: Promise<void> | undefined;

  try {
    for (const definition of options.services) {
      const handle = await definition.start();
      const startedService = {definition, handle};
      services.push(startedService);
      observeModuleServiceCompletion({startedService, isStopping: () => stopping, options});
      logger().info({service: definition.name}, 'Module service started');
    }
  } catch (error) {
    stopping = true;
    await stopStartedModuleServices(services);
    throw error;
  }

  return {
    stop: () => {
      stopping = true;
      stopPromise ??= stopStartedModuleServices(services);
      return stopPromise;
    },
  };
}

function observeModuleServiceCompletion(options: {
  startedService: StartedModuleService;
  isStopping(): boolean;
  options: StartModuleServicesOptions;
}): void {
  const {definition, handle} = options.startedService;
  void handle.finished.then(
    () => {
      if (options.isStopping()) return;
      reportModuleServiceFailure(
        new Error(`Module service ${definition.name} stopped unexpectedly`),
        definition,
        options.options.onServiceFailure,
      );
    },
    (error: unknown) => {
      if (options.isStopping()) return;
      reportModuleServiceFailure(error, definition, options.options.onServiceFailure);
    },
  );
}

function reportModuleServiceFailure(
  error: unknown,
  service: ModuleService,
  onServiceFailure: StartModuleServicesOptions['onServiceFailure'],
): void {
  if (onServiceFailure) {
    void Promise.resolve(onServiceFailure(error, service)).catch((handlerError) => {
      logger().error(
        {err: handlerError, serviceErr: error, service: service.name},
        'Module service failure handler failed',
      );
    });
    return;
  }
  logger().error({err: error, service: service.name}, 'Module service stopped unexpectedly');
}

async function stopStartedModuleServices(services: StartedModuleService[]): Promise<void> {
  for (const service of [...services].reverse()) {
    await stopModuleService(service);
  }
}

async function stopModuleService(service: StartedModuleService): Promise<void> {
  const stopResult = Promise.resolve()
    .then(() => service.handle.stop())
    .then(
      () => ({status: 'stopped' as const}),
      (error: unknown) => ({status: 'failed' as const, error}),
    );
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{status: 'timed-out'}>((resolve) => {
    timeoutId = setTimeout(
      () => resolve({status: 'timed-out'}),
      service.definition.shutdownTimeoutMs,
    );
  });
  const result = await Promise.race([stopResult, timeout]);
  if (timeoutId) clearTimeout(timeoutId);

  if (result.status === 'stopped') return;
  if (result.status === 'failed') {
    logger().warn(
      {err: result.error, service: service.definition.name},
      'Failed to stop module service',
    );
    return;
  }

  logger().error(
    {service: service.definition.name, timeoutMs: service.definition.shutdownTimeoutMs},
    'Timed out stopping module service',
  );
  void stopResult.then((lateResult) => {
    if (lateResult.status !== 'failed') return;
    logger().warn(
      {err: lateResult.error, service: service.definition.name},
      'Module service stop failed after timeout',
    );
  });
}

/**
 * Creates Temporal workers for all module-declared workers and starts their workflows.
 * Call this after `initializeModules` so that all publishers/subscribers are registered.
 */
export async function startModuleWorkers(
  options: StartModuleWorkersOptions,
): Promise<ModuleWorkersHandle> {
  if (options.workers.length === 0) return {stop: async () => undefined};

  await createTemporalClient();
  let connection: NativeConnection | undefined;
  const workers: StartedModuleWorker[] = [];
  let stopping = false;
  let stopPromise: Promise<void> | undefined;

  try {
    connection = await createTemporalWorkerConnection();

    for (const workerDef of options.workers) {
      try {
        const worker = await createTemporalWorker({
          connection,
          taskQueue: workerDef.taskQueue,
          workflowsPath: workerDef.workflowsPath,
          activities: workerDef.activities(),
        });
        const startedWorker: StartedModuleWorker = {worker};
        workers.push(startedWorker);

        for (const workflow of workerDef.workflows) {
          try {
            await temporalClient().workflow.start(workflow.name, {
              taskQueue: workerDef.taskQueue,
              workflowId: workflow.id,
              ...(workflow.args ? {args: workflow.args} : {}),
              ...(workflow.cronSchedule ? {cronSchedule: workflow.cronSchedule} : {}),
            });
          } catch (error) {
            if (error instanceof Error && error.name === 'WorkflowExecutionAlreadyStartedError') {
              logger().info({workflowId: workflow.id}, 'Workflow already running, skipping start');
            } else {
              throw error;
            }
          }
        }

        const runPromise = worker.run();
        startedWorker.runPromise = runPromise;
        runPromise.catch((error) => {
          if (stopping) return;
          if (options.onWorkerFailure) {
            void Promise.resolve(options.onWorkerFailure(error, workerDef)).catch(
              (handlerError) => {
                logger().error(
                  {err: handlerError, workerErr: error, taskQueue: workerDef.taskQueue},
                  'Module worker failure handler failed',
                );
              },
            );
            return;
          }
          logger().error(
            {err: error, taskQueue: workerDef.taskQueue},
            'Worker stopped unexpectedly',
          );
        });

        logger().info({taskQueue: workerDef.taskQueue}, 'Module worker started');
      } catch (error) {
        throw new Error(`Failed to start module worker for task queue ${workerDef.taskQueue}`, {
          cause: error,
        });
      }
    }
  } catch (error) {
    stopping = true;
    await cleanUpFailedModuleWorkerStartup({error, workers, connection});
    throw error;
  }

  return {
    stop: () => {
      stopping = true;
      stopPromise ??= stopModuleWorkers({workers, connection});
      return stopPromise;
    },
  };
}

async function stopModuleWorkers(options: {
  workers: StartedModuleWorker[];
  connection: NativeConnection;
}): Promise<void> {
  for (const {worker} of options.workers) {
    try {
      worker.shutdown();
    } catch (error) {
      logger().warn({err: error}, 'Failed to shut down module worker');
    }
  }

  const results = await Promise.allSettled(
    options.workers.flatMap(({runPromise}) => (runPromise ? [runPromise] : [])),
  );
  for (const result of results) {
    if (result.status === 'rejected') {
      logger().error({err: result.reason}, 'Module worker stopped with an error');
    }
  }

  try {
    await options.connection.close();
  } finally {
    await closeTemporalClient();
  }
}

async function cleanUpFailedModuleWorkerStartup(options: {
  error: unknown;
  workers: StartedModuleWorker[];
  connection: NativeConnection | undefined;
}): Promise<void> {
  try {
    if (options.connection) {
      await stopModuleWorkers({workers: options.workers, connection: options.connection});
    } else {
      await closeTemporalClient();
    }
  } catch (cleanupError) {
    logger().error(
      {err: cleanupError, workerErr: options.error},
      'Failed to clean up module worker startup resources',
    );
  }
}
