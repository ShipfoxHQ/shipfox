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
import {
  WORKFLOWS_JOB_ACTIVATED,
  WORKFLOWS_JOB_TERMINATED,
  type WorkflowsEventMapDto,
} from '@shipfox/api-workflows-dto';
import {type ShipfoxModule, subscriberFactory} from '@shipfox/node-module';
import {db, migrationsPath, triggersOutbox} from '#db/index.js';
import {registerTriggersServiceMetrics} from '#metrics/index.js';
import {routes} from '#presentation/index.js';
import {
  onDefinitionDeleted,
  onDefinitionResolved,
  onIntegrationEventReceived,
  onJobActivated,
  onJobTerminated,
} from '#presentation/subscribers/index.js';
import {
  createTriggersCronActivities,
  createTriggersMaintenanceActivities,
} from '#temporal/activities/index.js';
import {TRIGGERS_CRON_TASK_QUEUE, TRIGGERS_MAINTENANCE_TASK_QUEUE} from '#temporal/constants.js';

export type {
  JobListenerMatcherKind,
  JobListenerSubscription,
} from '#core/entities/job-listener-subscription.js';
export type {TriggerSubscription} from '#core/entities/subscription.js';
export {
  fireCronSubscription,
  fireManualSubscription,
  ManualTriggerNotFoundError,
  TriggerSubscriptionNotCronError,
  TriggerSubscriptionNotFoundError,
  TriggerSubscriptionNotManualError,
  TriggerWorkspaceMismatchError,
} from '#core/index.js';
export {
  db,
  findMatchingJobListenerSubscriptions,
  findMatchingSubscriptions,
  getManualSubscriptionByDefinitionId,
  getTriggerSubscriptionById,
  jobListenerSubscriptions,
  listSubscriptionsByWorkflowDefinitionIds,
  migrationsPath,
  projectJobListenerSubscriptions,
  removeJobListenerSubscriptionsForJob,
  triggersOutbox,
} from '#db/index.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporalWorkflowsPath = resolve(packageRoot, 'dist/temporal/workflows/index.js');

const subscriber = subscriberFactory<
  DefinitionsEventMap & IntegrationsEventMap & WorkflowsEventMapDto
>();

export const triggersModule: ShipfoxModule = {
  name: 'triggers',
  database: {db, migrationsPath},
  routes,
  metrics: registerTriggersServiceMetrics,
  publishers: [{name: 'triggers', table: triggersOutbox, db}],
  subscribers: [
    subscriber(DEFINITION_RESOLVED, onDefinitionResolved),
    subscriber(DEFINITION_DELETED, onDefinitionDeleted),
    subscriber(INTEGRATION_EVENT_RECEIVED, onIntegrationEventReceived),
    subscriber(WORKFLOWS_JOB_ACTIVATED, onJobActivated),
    subscriber(WORKFLOWS_JOB_TERMINATED, onJobTerminated),
  ],
  workers: [
    {
      taskQueue: TRIGGERS_MAINTENANCE_TASK_QUEUE,
      workflowsPath: temporalWorkflowsPath,
      activities: createTriggersMaintenanceActivities,
      workflows: [
        {
          name: 'pruneTriggerEventsCron',
          id: 'triggers-prune-trigger-events',
          cronSchedule: '0 * * * *',
        },
      ],
    },
    {
      taskQueue: TRIGGERS_CRON_TASK_QUEUE,
      workflowsPath: temporalWorkflowsPath,
      activities: createTriggersCronActivities,
      workflows: [
        {
          name: 'cronTickCron',
          id: 'triggers-cron-tick',
          cronSchedule: '* * * * *',
        },
      ],
    },
  ],
};
