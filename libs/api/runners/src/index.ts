import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {WORKFLOWS_JOB_TIMED_OUT} from '@shipfox/api-workflows-dto';
import type {ShipfoxModule} from '@shipfox/node-module';
import {db, migrationsPath, runnersOutbox} from '#db/index.js';
import {createRunnerTokenAuthMethod, onWorkflowsJobTimedOut, routes} from '#presentation/index.js';
import {createRunnersMaintenanceActivities} from '#temporal/activities/index.js';
import {RUNNERS_MAINTENANCE_TASK_QUEUE} from '#temporal/constants.js';

export type {RunnerToken} from '#core/index.js';
export {completeJob, RunningJobNotFoundError} from '#core/index.js';
export type {ClaimedJob, EnqueueJobParams} from '#db/index.js';
export {
  claimJob,
  createRunnerToken,
  db,
  enqueueJob,
  migrationsPath,
  resolveRunnerTokenByHash,
  revokeRunnerToken,
  runnersOutbox,
} from '#db/index.js';
export {createRunnerTokenAuthMethod, routes} from '#presentation/index.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflowsPath = resolve(packageRoot, 'dist/temporal/workflows/index.js');

export const runnersModule: ShipfoxModule = {
  name: 'runners',
  database: {db, migrationsPath},
  auth: [createRunnerTokenAuthMethod()],
  routes,
  publishers: [{name: 'runners', table: runnersOutbox, db}],
  subscribers: [{event: WORKFLOWS_JOB_TIMED_OUT, handler: onWorkflowsJobTimedOut}],
  workers: [
    {
      taskQueue: RUNNERS_MAINTENANCE_TASK_QUEUE,
      workflowsPath,
      activities: createRunnersMaintenanceActivities,
      workflows: [{name: 'stuckJobDetector', id: 'stuck-job-detector', cronSchedule: '* * * * *'}],
    },
  ],
};
