import {annotationsModule} from '@shipfox/annotations';
import {agentModule} from '@shipfox/api-agent';
import {authModule} from '@shipfox/api-auth';
import {createDefinitionsModule} from '@shipfox/api-definitions';
import {dispatcherModule} from '@shipfox/api-dispatcher';
import {
  buildAgentToolCatalogs,
  buildAgentToolSelectionCatalogs,
  createIntegrationsContext,
  createWorkspaceConnectionSnapshotLoader,
  getIntegrationConnectionById,
} from '@shipfox/api-integration-core';
import {logsModule} from '@shipfox/api-logs';
import {createProjectsModule} from '@shipfox/api-projects';
import {runnersModule} from '@shipfox/api-runners';
import {deleteSecrets, getSecret, secretsModule, setSecrets} from '@shipfox/api-secrets';
import {triggersModule} from '@shipfox/api-triggers';
import {
  setAgentToolMaterializationServices,
  setSourceControl,
  workflowsModule,
} from '@shipfox/api-workflows';
import {workspacesModule} from '@shipfox/api-workspaces';
import {captureException, closeErrorMonitoring} from '@shipfox/node-error-monitoring';
import {closeApp, createApp, listen} from '@shipfox/node-fastify';
import type {ModuleWorker} from '@shipfox/node-module';
import {initializeModules, registerModuleMetrics, startModuleWorkers} from '@shipfox/node-module';
import {logger, startServiceMetrics} from '@shipfox/node-opentelemetry';
import {createPostgresClient} from '@shipfox/node-postgres';
import {config, parseApiTrustProxy} from '../config.js';
import {createE2eAdminAuthMethod, createE2eRouteGroup} from './e2e.js';

const WORKER_FAILURE_HTTP_SHUTDOWN_TIMEOUT_MS = 10_000;
const WORKER_FAILURE_ERROR_MONITORING_SHUTDOWN_TIMEOUT_MS = 2_000;

export async function run(): Promise<void> {
  startServiceMetrics({serviceName: 'api'});

  createPostgresClient();

  const integrations = await createIntegrationsContext({
    secrets: {
      deleteSecrets,
      linear: {
        getSecret: (params) =>
          getSecret({
            ...params,
            namespace: `system/integrations/linear/${params.namespace}`,
          }),
        setSecrets: (params) =>
          setSecrets({
            ...params,
            namespace: `system/integrations/linear/${params.namespace}`,
          }),
      },
    },
  });
  const [agentToolSelectionCatalogs, agentToolCatalogs] = await Promise.all([
    buildAgentToolSelectionCatalogs(integrations.registry),
    buildAgentToolCatalogs(integrations.registry),
  ]);
  const loadWorkspaceConnectionSnapshot = createWorkspaceConnectionSnapshotLoader(
    integrations.registry,
  );
  // The checkout-token route resolves intents and mints credentials through the
  // source-control service; wire it into the workflows module before serving.
  setSourceControl(integrations.sourceControl);
  setAgentToolMaterializationServices({
    catalogs: agentToolCatalogs,
    loadWorkspaceConnectionSnapshot,
    getIntegrationConnectionById,
  });
  const projectsModule = createProjectsModule({sourceControl: integrations.sourceControl});
  const definitionsModule = createDefinitionsModule({
    sourceControl: integrations.sourceControl,
    agentToolSelectionCatalogs,
    loadWorkspaceConnectionSnapshot,
    getIntegrationConnectionById,
  });

  const modules = [
    authModule,
    workspacesModule,
    secretsModule,
    agentModule,
    integrations.module,
    projectsModule,
    definitionsModule,
    workflowsModule,
    annotationsModule,
    runnersModule,
    logsModule,
    triggersModule,
    dispatcherModule,
  ];
  const {auth, routes, e2eRoutes, workers} = await initializeModules({modules});
  // Gauge callbacks query migrated tables, so register them after module initialization.
  registerModuleMetrics({modules});
  // Boot-time provider tasks (post-migration). No-op when no enabled provider contributes
  // one; failures are isolated and logged, never thrown, so they cannot gate boot.
  await integrations.runStartupTasks();

  const e2eAuth = config.E2E_ENABLED ? [createE2eAdminAuthMethod(config)] : [];
  const mountedE2eRoutes = createE2eRouteGroup(e2eRoutes, config);

  logger().info('Creating HTTP server');
  await createApp({
    auth: [...auth, ...e2eAuth],
    routes: [...routes, ...mountedE2eRoutes],
    fastifyOptions: {trustProxy: parseApiTrustProxy(config.API_TRUST_PROXY)},
  });
  logger().info('Starting module workers');
  await startModuleWorkers({workers, onWorkerFailure: handleModuleWorkerFailure});

  logger().info('Starting HTTP server');
  const address =
    config.API_PORT === undefined ? await listen() : await listen({port: config.API_PORT});
  logger().info({address}, 'HTTP server listening');
}

export async function handleModuleWorkerFailure(
  error: unknown,
  worker: ModuleWorker,
): Promise<never> {
  logger().error({err: error, taskQueue: worker.taskQueue}, 'Module worker stopped unexpectedly');
  captureException(error);

  try {
    await closeHttpServerAfterWorkerFailure();
    await closeErrorMonitoring(WORKER_FAILURE_ERROR_MONITORING_SHUTDOWN_TIMEOUT_MS);
  } finally {
    process.exit(1);
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
