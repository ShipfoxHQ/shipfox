import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  DEFINITION_DELETED,
  DEFINITION_RESOLVED,
  type DefinitionsEventMap,
} from '@shipfox/api-definitions-dto';
import {
  INTEGRATION_EVENT_RECEIVED,
  type IntegrationsEventMap,
} from '@shipfox/api-integration-core-dto';
import {type ShipfoxModule, subscriberFactory} from '@shipfox/node-module';
import {db, migrationsPath, triggersOutbox} from '#db/index.js';
import {routes} from '#presentation/index.js';
import {
  onDefinitionDeleted,
  onDefinitionResolved,
  onIntegrationEventReceived,
} from '#presentation/subscribers/index.js';
import {createTriggersMaintenanceActivities} from '#temporal/activities/index.js';
import {TRIGGERS_MAINTENANCE_TASK_QUEUE} from '#temporal/constants.js';

export type {TriggerSubscription} from '#core/entities/subscription.js';
export {
  fireManualSubscription,
  ManualTriggerNotFoundError,
  TriggerSubscriptionNotFoundError,
  TriggerSubscriptionNotManualError,
  TriggerWorkspaceMismatchError,
} from '#core/index.js';
export {
  db,
  findMatchingSubscriptions,
  getManualSubscriptionByDefinitionId,
  getTriggerSubscriptionById,
  listSubscriptionsByWorkflowDefinitionIds,
  migrationsPath,
  triggersOutbox,
} from '#db/index.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const maintenanceWorkflowsPath = resolve(packageRoot, 'dist/temporal/workflows/index.js');

const subscriber = subscriberFactory<DefinitionsEventMap & IntegrationsEventMap>();

export const triggersModule: ShipfoxModule = {
  name: 'triggers',
  database: {db, migrationsPath},
  routes,
  publishers: [{name: 'triggers', table: triggersOutbox, db}],
  subscribers: [
    subscriber(DEFINITION_RESOLVED, onDefinitionResolved),
    subscriber(DEFINITION_DELETED, onDefinitionDeleted),
    subscriber(INTEGRATION_EVENT_RECEIVED, onIntegrationEventReceived),
  ],
  workers: [
    {
      taskQueue: TRIGGERS_MAINTENANCE_TASK_QUEUE,
      workflowsPath: maintenanceWorkflowsPath,
      activities: createTriggersMaintenanceActivities,
      workflows: [
        {
          name: 'pruneTriggerEventsCron',
          id: 'triggers-prune-trigger-events',
          cronSchedule: '0 * * * *',
        },
      ],
    },
  ],
};
