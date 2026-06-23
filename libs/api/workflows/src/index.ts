import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  RUNNER_JOB_CLAIMED,
  RUNNER_JOB_LEASE_EXPIRED,
  RUNNER_JOB_QUEUED,
  type RunnersEventMap,
} from '@shipfox/api-runners-dto';
import {
  WORKFLOWS_JOB_STEPS_SETTLED,
  WORKFLOWS_WORKFLOW_RUN_CREATED,
  type WorkflowsEventMap,
  workflowsEventSchemas,
} from '@shipfox/api-workflows-dto';
import {type ShipfoxModule, subscriberFactory} from '@shipfox/node-module';
import {db, migrationsPath, workflowsOutbox} from '#db/index.js';
import {
  onJobStepsSettled,
  onRunnerJobClaimed,
  onRunnerJobLeaseExpired,
  onRunnerJobQueued,
  onWorkflowRunCreated,
  routes,
} from '#presentation/index.js';
import {createOrchestrationActivities, WORKFLOWS_TASK_QUEUE} from '#temporal/index.js';

export type {
  Job,
  RunWorkflowParams,
  Step,
  TriggerPayload,
  WorkflowRun,
  WorkflowSourceSnapshot,
} from '#core/index.js';
export {
  DefinitionNotFoundError,
  isPermanentRunWorkflowError,
  ProjectMismatchError,
  runWorkflow,
} from '#core/index.js';
export {setSourceControl} from '#core/source-control.js';
export {db, migrationsPath, workflowsOutbox} from '#db/index.js';
export {routes} from '#presentation/index.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflowsPath = resolve(packageRoot, 'dist/temporal/workflows/index.js');

const subscriber = subscriberFactory<WorkflowsEventMap & RunnersEventMap>();

export const workflowsModule: ShipfoxModule = {
  name: 'workflows',
  database: {db, migrationsPath},
  routes,
  publishers: [
    {name: 'workflows', table: workflowsOutbox, db, eventSchemas: workflowsEventSchemas},
  ],
  subscribers: [
    subscriber(WORKFLOWS_WORKFLOW_RUN_CREATED, onWorkflowRunCreated),
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
