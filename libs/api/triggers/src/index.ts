import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import {
  DEFINITION_AGENT_RULES_RESOLVED,
  DEFINITION_DELETED,
  DEFINITION_RESOLVED,
  type DefinitionsEventMap,
} from '@shipfox/api-definitions-dto';
import type {DefinitionsInterModuleClient} from '@shipfox/api-definitions-dto/inter-module';
import {
  INTEGRATION_EVENT_RECEIVED,
  type IntegrationsEventMap,
} from '@shipfox/api-integration-core-dto';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import type {SecretsInterModuleClient} from '@shipfox/api-secrets-dto/inter-module';
import {
  WORKFLOWS_JOB_ACTIVATED,
  WORKFLOWS_JOB_EXECUTION_QUEUED,
  WORKFLOWS_JOB_EXECUTION_STARTED,
  WORKFLOWS_JOB_TERMINATED,
  WORKFLOWS_WORKFLOW_RUN_ATTEMPT_CREATED,
  WORKFLOWS_WORKFLOW_RUN_STARTED,
  WORKFLOWS_WORKFLOW_RUN_TERMINATED,
  type WorkflowsEventMapDto,
} from '@shipfox/api-workflows-dto';
import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import {type ShipfoxModule, subscriberFactory} from '@shipfox/node-module';
import {db, migrationsPath, triggersOutbox} from '#db/index.js';
import {registerTriggersServiceMetrics} from '#metrics/index.js';
import {createTriggersE2eRoutes} from '#presentation/e2e-routes.js';
import {createTriggerRoutes} from '#presentation/index.js';
import {createTriggersInterModulePresentation} from '#presentation/inter-module.js';
import {
  createOnIntegrationEventReceived,
  createOnShipfoxLifecycleEvent,
  onDefinitionAgentRulesResolved,
  onDefinitionDeleted,
  onDefinitionResolved,
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
  checkDevRun,
  createDevRun,
  DevRunInputsNotAllowedError,
  DevRunProjectAccessError,
  DevRunReplayEventMismatchError,
  DevRunReplayEventNotAllowedError,
  DevRunReplayEventNotFoundError,
  DevRunReplayEventRequiredError,
  DevRunReplayEventUnavailableError,
  DevRunTriggerFilteredError,
  DevRunTriggerNotFoundError,
  fireCronSubscription,
  fireManualSubscription,
  fireManualTrigger,
  ManualTriggerNotFoundError,
  pinSecretInputs,
  SecretInputMissingError,
  SecretInputNotFoundError,
  type SecretInputReference,
  type SecretInputSource,
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

export interface CreateTriggersModuleOptions {
  workflows: WorkflowsModuleClient;
  definitions: DefinitionsInterModuleClient;
  projects: ProjectsModuleClient;
  secrets: SecretsInterModuleClient;
  /**
   * Enables the E2E synthetic dispatch route when supplied by the composition root. With `agent`,
   * it also reads interactions from connections that support them.
   */
  integrations?: IntegrationsModuleClient | undefined;
  /** Routes interactions to agents. Without it, no event reaches an agent. */
  agent?: AgentInterModuleClient | undefined;
}

export function createTriggersModule({
  workflows,
  definitions,
  projects,
  secrets,
  integrations,
  agent,
}: CreateTriggersModuleOptions): ShipfoxModule {
  return {
    name: 'triggers',
    database: {db, migrationsPath, databaseNamespace: 'triggers'},
    routes: createTriggerRoutes(workflows, definitions, projects, secrets),
    e2eRoutes: [createTriggersE2eRoutes({workflows, secrets, integrations})],
    metrics: registerTriggersServiceMetrics,
    interModulePresentations: [
      createTriggersInterModulePresentation({
        definitions,
        projects,
        secrets,
        workflows,
      }),
    ],
    publishers: [{name: 'triggers', table: triggersOutbox, db}],
    subscribers: [
      subscriber(DEFINITION_RESOLVED, onDefinitionResolved),
      subscriber(DEFINITION_AGENT_RULES_RESOLVED, onDefinitionAgentRulesResolved),
      subscriber(DEFINITION_DELETED, onDefinitionDeleted),
      subscriber(
        INTEGRATION_EVENT_RECEIVED,
        createOnIntegrationEventReceived(
          workflows,
          secrets,
          integrations && agent ? {integrations, agent} : undefined,
          projects,
        ),
      ),
      subscriber(WORKFLOWS_JOB_ACTIVATED, onJobActivated),
      subscriber(WORKFLOWS_JOB_TERMINATED, onJobTerminated),
      subscriber(
        WORKFLOWS_WORKFLOW_RUN_ATTEMPT_CREATED,
        createOnShipfoxLifecycleEvent(workflows, 'run.requested'),
      ),
      subscriber(
        WORKFLOWS_WORKFLOW_RUN_STARTED,
        createOnShipfoxLifecycleEvent(workflows, 'run.started'),
      ),
      subscriber(
        WORKFLOWS_WORKFLOW_RUN_TERMINATED,
        createOnShipfoxLifecycleEvent(workflows, 'run.completed'),
      ),
      subscriber(
        WORKFLOWS_JOB_EXECUTION_QUEUED,
        createOnShipfoxLifecycleEvent(workflows, 'job.queued'),
      ),
      subscriber(
        WORKFLOWS_JOB_EXECUTION_STARTED,
        createOnShipfoxLifecycleEvent(workflows, 'job.started'),
      ),
      subscriber(
        WORKFLOWS_JOB_TERMINATED,
        createOnShipfoxLifecycleEvent(workflows, 'job.completed'),
      ),
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
        activities: () => createTriggersCronActivities(workflows, secrets),
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
}
