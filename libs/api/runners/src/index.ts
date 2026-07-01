import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runnersEventSchemas} from '@shipfox/api-runners-dto';
import {
  WORKFLOWS_JOB_EXECUTION_TIMED_OUT,
  type WorkflowsEventMap,
} from '@shipfox/api-workflows-dto';
import {type ShipfoxModule, subscriberFactory} from '@shipfox/node-module';
import {db, migrationsPath, runnersOutbox} from '#db/index.js';
import {registerRunnersServiceMetrics} from '#metrics/index.js';
import {
  createProvisionerTokenAuthMethod,
  createRunnerRegistrationTokenAuthMethod,
  onWorkflowsJobExecutionTimedOut,
  routes,
} from '#presentation/index.js';
import {createRunnersMaintenanceActivities} from '#temporal/activities/index.js';
import {RUNNERS_MAINTENANCE_TASK_QUEUE} from '#temporal/constants.js';

export {
  type MintEphemeralRegistrationTokenParams,
  type MintEphemeralRegistrationTokenResult,
  type MintEphemeralRegistrationTokensBatchParams,
  type MintEphemeralRegistrationTokensBatchProvisionedRunner,
  type MintEphemeralRegistrationTokensBatchResult,
  mintEphemeralRegistrationToken,
  mintEphemeralRegistrationTokensBatch,
} from '#core/ephemeral-registration-tokens.js';
export {
  cancelRunnerJobs,
  type EnqueueJobExecutionParams,
  enqueueJobExecution,
  isJobLeaseActive,
  releaseJobExecution,
} from '#db/index.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflowsPath = resolve(packageRoot, 'dist/temporal/workflows/index.js');

const subscriber = subscriberFactory<WorkflowsEventMap>();

export const runnersModule: ShipfoxModule = {
  name: 'runners',
  database: {db, migrationsPath},
  auth: [createRunnerRegistrationTokenAuthMethod(), createProvisionerTokenAuthMethod()],
  routes,
  metrics: registerRunnersServiceMetrics,
  publishers: [{name: 'runners', table: runnersOutbox, db, eventSchemas: runnersEventSchemas}],
  subscribers: [subscriber(WORKFLOWS_JOB_EXECUTION_TIMED_OUT, onWorkflowsJobExecutionTimedOut)],
  workers: [
    {
      taskQueue: RUNNERS_MAINTENANCE_TASK_QUEUE,
      workflowsPath,
      activities: createRunnersMaintenanceActivities,
      workflows: [{name: 'stuckJobDetector', id: 'stuck-job-detector', cronSchedule: '* * * * *'}],
    },
  ],
};
