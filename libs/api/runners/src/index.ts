import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {WORKFLOWS_JOB_TIMED_OUT, type WorkflowsEventMap} from '@shipfox/api-workflows-dto';
import {type ShipfoxModule, subscriberFactory} from '@shipfox/node-module';
import {db, migrationsPath, runnersOutbox} from '#db/index.js';
import {createRunnerTokenAuthMethod, onWorkflowsJobTimedOut, routes} from '#presentation/index.js';
import {createRunnersMaintenanceActivities} from '#temporal/activities/index.js';
import {RUNNERS_MAINTENANCE_TASK_QUEUE} from '#temporal/constants.js';

export {releaseJob, type ScheduleJobParams, scheduleJob} from '#db/index.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflowsPath = resolve(packageRoot, 'dist/temporal/workflows/index.js');

const subscriber = subscriberFactory<WorkflowsEventMap>();

export const runnersModule: ShipfoxModule = {
  name: 'runners',
  database: {db, migrationsPath},
  auth: [createRunnerTokenAuthMethod()],
  routes,
  publishers: [{name: 'runners', table: runnersOutbox, db}],
  subscribers: [subscriber(WORKFLOWS_JOB_TIMED_OUT, onWorkflowsJobTimedOut)],
  workers: [
    {
      taskQueue: RUNNERS_MAINTENANCE_TASK_QUEUE,
      workflowsPath,
      activities: createRunnersMaintenanceActivities,
      workflows: [{name: 'stuckJobDetector', id: 'stuck-job-detector', cronSchedule: '* * * * *'}],
    },
  ],
};
