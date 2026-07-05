import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  RUNNER_JOB_CLAIMED,
  RUNNER_JOB_LEASE_EXPIRED,
  RUNNER_JOB_QUEUED,
  type RunnersEventMap,
} from '@shipfox/api-runners-dto';
import {
  WORKFLOWS_JOB_EVENT_DELIVERED,
  WORKFLOWS_JOB_STEPS_SETTLED,
  WORKFLOWS_WORKFLOW_RUN_ATTEMPT_CREATED,
  WORKFLOWS_WORKFLOW_RUN_CANCELLED,
  type WorkflowsEventMapDto,
  workflowsEventSchemas,
} from '@shipfox/api-workflows-dto';
import {type ShipfoxModule, subscriberFactory} from '@shipfox/node-module';
import {db, migrationsPath, workflowsOutbox} from '#db/index.js';
import {registerWorkflowsServiceMetrics} from '#metrics/index.js';
import {
  onJobEventDelivered,
  onJobStepsSettled,
  onRunnerJobClaimed,
  onRunnerJobLeaseExpired,
  onRunnerJobQueued,
  onWorkflowRunAttemptCreated,
  onWorkflowRunCancelled,
  routes,
} from '#presentation/index.js';
import {createOrchestrationActivities, WORKFLOWS_TASK_QUEUE} from '#temporal/index.js';

export type {
  Job,
  JobListenerEvent,
  JobListenerEventDisposition,
  RunWorkflowParams,
  Step,
  TriggerPayload,
  WorkflowRun,
  WorkflowSourceSnapshot,
} from '#core/index.js';
export {
  DefinitionNotFoundError,
  InterpolationUnresolvableError,
  isPermanentRunWorkflowError,
  ProjectMismatchError,
  runWorkflow,
  WorkflowRunNotCancellableError,
} from '#core/index.js';
export {setSourceControl} from '#core/source-control.js';
export {
  closeDb,
  type DeliverEventToListenerParams,
  type DeliverEventToListenerResult,
  db,
  deliverEventToListener,
  getStepById,
  getStepByIdForJobExecution,
  migrationsPath,
  workflowsOutbox,
} from '#db/index.js';
export {routes} from '#presentation/index.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflowsPath = resolve(packageRoot, 'dist/temporal/workflows/index.js');

const subscriber = subscriberFactory<WorkflowsEventMapDto & RunnersEventMap>();

export const workflowsModule: ShipfoxModule = {
  name: 'workflows',
  database: {db, migrationsPath},
  routes,
  metrics: registerWorkflowsServiceMetrics,
  publishers: [
    {name: 'workflows', table: workflowsOutbox, db, eventSchemas: workflowsEventSchemas},
  ],
  subscribers: [
    subscriber(WORKFLOWS_WORKFLOW_RUN_ATTEMPT_CREATED, onWorkflowRunAttemptCreated),
    subscriber(WORKFLOWS_WORKFLOW_RUN_CANCELLED, onWorkflowRunCancelled),
    subscriber(WORKFLOWS_JOB_EVENT_DELIVERED, onJobEventDelivered),
    subscriber(WORKFLOWS_JOB_STEPS_SETTLED, onJobStepsSettled),
    subscriber(RUNNER_JOB_LEASE_EXPIRED, onRunnerJobLeaseExpired),
    subscriber(RUNNER_JOB_QUEUED, onRunnerJobQueued),
    subscriber(RUNNER_JOB_CLAIMED, onRunnerJobClaimed),
  ],
  workers: [
    {
      taskQueue: WORKFLOWS_TASK_QUEUE,
      workflowsPath,
      activities: createOrchestrationActivities,
      workflows: [],
    },
  ],
};
