import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  DEFINITION_RESOLVED,
  type DefinitionsEventMap,
  definitionsEventSchemas,
} from '@shipfox/api-definitions-dto';
import type {
  AgentToolSelectionCatalogs,
  GetIntegrationConnectionByIdFn,
  IntegrationSourceControlService,
  LoadWorkspaceConnectionSnapshot,
} from '@shipfox/api-integration-core';
import {
  PROJECT_SOURCE_BOUND,
  PROJECT_SOURCE_COMMIT_OBSERVED,
  type ProjectsEventMap,
} from '@shipfox/api-projects-dto';
import {type ShipfoxModule, subscriberFactory} from '@shipfox/node-module';
import {logger} from '@shipfox/node-opentelemetry';
import {db, definitionsOutbox, migrationsPath} from '#db/index.js';
import {createDefinitionRoutes} from '#presentation/index.js';
import {
  onProjectSourceBound,
  onProjectSourceCommitObserved,
} from '#presentation/subscribers/index.js';
import {createDefinitionSyncActivities, DEFINITIONS_TASK_QUEUE} from '#temporal/index.js';

export type {
  WorkflowDefinition,
  WorkflowDefinitionPayload,
  WorkflowEnvTemplates,
  WorkflowModel,
  WorkflowModelJobCheckout,
  WorkflowSourceSnapshot,
  WorkflowSpec,
} from '#core/index.js';
export {
  DEFAULT_JOB_CHECKOUT,
  DEFAULT_JOB_SUCCESS,
  DEFAULT_RUN_TIMEOUT_MS,
  normalizeWorkflowDocument,
} from '#core/index.js';
export {db, definitionsOutbox, getDefinitionById, migrationsPath} from '#db/index.js';
export {routes} from '#presentation/index.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflowsPath = resolve(packageRoot, 'dist/temporal/workflows/index.js');

const subscriber = subscriberFactory<DefinitionsEventMap & ProjectsEventMap>();

export interface CreateDefinitionsModuleOptions {
  sourceControl: IntegrationSourceControlService;
  agentToolSelectionCatalogs?: AgentToolSelectionCatalogs | undefined;
  loadWorkspaceConnectionSnapshot?: LoadWorkspaceConnectionSnapshot | undefined;
  getIntegrationConnectionById?: GetIntegrationConnectionByIdFn | undefined;
}

export function createDefinitionsModule({
  sourceControl,
  agentToolSelectionCatalogs,
  loadWorkspaceConnectionSnapshot,
  getIntegrationConnectionById,
}: CreateDefinitionsModuleOptions): ShipfoxModule {
  const integrationValidation =
    agentToolSelectionCatalogs === undefined ||
    loadWorkspaceConnectionSnapshot === undefined ||
    getIntegrationConnectionById === undefined
      ? undefined
      : {
          agentToolSelectionCatalogs,
          loadWorkspaceConnectionSnapshot,
          getIntegrationConnectionById,
        };

  return {
    name: 'definitions',
    database: {db, migrationsPath},
    routes: createDefinitionRoutes({agentToolSelectionCatalogs, loadWorkspaceConnectionSnapshot}),
    publishers: [
      {name: 'definitions', table: definitionsOutbox, db, eventSchemas: definitionsEventSchemas},
    ],
    subscribers: [
      subscriber(DEFINITION_RESOLVED, (_payload, event) => {
        logger().info({event}, 'Definition resolved');
        return Promise.resolve();
      }),
      subscriber(PROJECT_SOURCE_BOUND, onProjectSourceBound),
      subscriber(PROJECT_SOURCE_COMMIT_OBSERVED, onProjectSourceCommitObserved),
    ],
    workers: [
      {
        taskQueue: DEFINITIONS_TASK_QUEUE,
        workflowsPath,
        activities: () => createDefinitionSyncActivities(sourceControl, integrationValidation),
        workflows: [],
      },
    ],
  };
}
