import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {RUNNER_JOB_LEASE_EXPIRED} from '@shipfox/api-runners-dto';
import {
  WORKFLOWS_JOB_STEPS_SETTLED,
  WORKFLOWS_WORKFLOW_RUN_CREATED,
} from '@shipfox/api-workflows-dto';
import type {ShipfoxModule} from '@shipfox/node-module';
import {db, migrationsPath, workflowsOutbox} from '#db/index.js';
import {
  onJobStepsSettled,
  onRunnerJobLeaseExpired,
  onWorkflowRunCreated,
  routes,
} from '#presentation/index.js';
import {createOrchestrationActivities, WORKFLOWS_TASK_QUEUE} from '#temporal/index.js';

export type {Job, RunWorkflowParams, Step, TriggerPayload, WorkflowRun} from '#core/index.js';
export {DefinitionNotFoundError, ProjectMismatchError, runWorkflow} from '#core/index.js';
export {setSourceControl} from '#core/source-control.js';
export {db, migrationsPath, workflowsOutbox} from '#db/index.js';
export {routes} from '#presentation/index.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflowsPath = resolve(packageRoot, 'dist/temporal/workflows/index.js');

export const workflowsModule: ShipfoxModule = {
  name: 'workflows',
  database: {db, migrationsPath},
  routes,
  publishers: [{name: 'workflows', table: workflowsOutbox, db}],
  subscribers: [
    {event: WORKFLOWS_WORKFLOW_RUN_CREATED, handler: onWorkflowRunCreated},
    {event: WORKFLOWS_JOB_STEPS_SETTLED, handler: onJobStepsSettled},
    {event: RUNNER_JOB_LEASE_EXPIRED, handler: onRunnerJobLeaseExpired},
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
