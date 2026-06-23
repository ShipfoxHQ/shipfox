import {authModule} from '@shipfox/api-auth';
import {createDefinitionsModule} from '@shipfox/api-definitions';
import {dispatcherModule} from '@shipfox/api-dispatcher';
import {createIntegrationsContext} from '@shipfox/api-integration-core';
import {logsModule} from '@shipfox/api-logs';
import {createProjectsModule} from '@shipfox/api-projects';
import {runnersModule} from '@shipfox/api-runners';
import {triggersModule} from '@shipfox/api-triggers';
import {setSourceControl, workflowsModule} from '@shipfox/api-workflows';
import {workspacesModule} from '@shipfox/api-workspaces';
import {createApp, listen} from '@shipfox/node-fastify';
import {initializeModules, registerModuleMetrics, startModuleWorkers} from '@shipfox/node-module';
import {
  logger,
  startInstanceInstrumentation,
  startServiceMetrics,
} from '@shipfox/node-opentelemetry';
import {createPostgresClient} from '@shipfox/node-postgres';
import {config} from '../config.js';
import {createE2eAdminAuthMethod, createE2eRouteGroup} from './e2e.js';

export async function run(): Promise<void> {
  await startInstanceInstrumentation({
    serviceName: 'api',
    instrumentations: {fastify: true, http: true, pg: true},
  });
  startServiceMetrics({serviceName: 'api'});

  createPostgresClient();

  const integrations = await createIntegrationsContext();
  // The checkout-token route resolves intents and mints credentials through the
  // source-control service; wire it into the workflows module before serving.
  setSourceControl(integrations.sourceControl);
  const projectsModule = createProjectsModule({sourceControl: integrations.sourceControl});
  const definitionsModule = createDefinitionsModule({sourceControl: integrations.sourceControl});

  const modules = [
    authModule,
    workspacesModule,
    integrations.module,
    projectsModule,
    definitionsModule,
    workflowsModule,
    runnersModule,
    logsModule,
    triggersModule,
    dispatcherModule,
  ];
  const {auth, routes, e2eRoutes, workers} = await initializeModules({modules});
  // Register service metrics after migrations so gauge callbacks can query the
  // database; the provider was started above with startServiceMetrics.
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
  });
  logger().info('Starting HTTP server');
  const address = await listen();
  logger().info({address}, 'HTTP server listening');

  startModuleWorkers({workers});
}
