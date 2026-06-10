import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DEFINITION_RESOLVED} from '@shipfox/api-definitions-dto';
import type {IntegrationSourceControlService} from '@shipfox/api-integration-core';
import {PROJECT_SOURCE_BOUND, PROJECT_SOURCE_COMMIT_OBSERVED} from '@shipfox/api-projects-dto';
import type {ShipfoxModule} from '@shipfox/node-module';
import {logger} from '@shipfox/node-opentelemetry';
import {db, definitionsOutbox, migrationsPath} from '#db/index.js';
import {routes} from '#presentation/index.js';
import {
  onProjectSourceBound,
  onProjectSourceCommitObserved,
} from '#presentation/subscribers/index.js';
import {createDefinitionSyncActivities, DEFINITIONS_TASK_QUEUE} from '#temporal/index.js';

export type {
  WorkflowDefinition,
  WorkflowDefinitionPayload,
  WorkflowModel,
  WorkflowSpec,
} from '#core/index.js';
export {db, definitionsOutbox, getDefinitionById, migrationsPath} from '#db/index.js';
export {routes} from '#presentation/index.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflowsPath = resolve(packageRoot, 'dist/temporal/workflows/index.js');

export interface CreateDefinitionsModuleOptions {
  sourceControl: IntegrationSourceControlService;
}

export function createDefinitionsModule({
  sourceControl,
}: CreateDefinitionsModuleOptions): ShipfoxModule {
  return {
    name: 'definitions',
    database: {db, migrationsPath},
    routes,
    publishers: [{name: 'definitions', table: definitionsOutbox, db}],
    subscribers: [
      {
        event: DEFINITION_RESOLVED,
        handler: (event) => {
          logger().info({event}, 'Definition resolved');
          return Promise.resolve();
        },
      },
      {event: PROJECT_SOURCE_BOUND, handler: onProjectSourceBound},
      {event: PROJECT_SOURCE_COMMIT_OBSERVED, handler: onProjectSourceCommitObserved},
    ],
    workers: [
      {
        taskQueue: DEFINITIONS_TASK_QUEUE,
        workflowsPath,
        activities: () => createDefinitionSyncActivities(sourceControl),
        workflows: [],
      },
    ],
  };
}
