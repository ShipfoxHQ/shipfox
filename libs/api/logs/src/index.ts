import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {WORKFLOWS_JOB_TERMINATED, type WorkflowsEventMap} from '@shipfox/api-workflows-dto';
import {type ShipfoxModule, subscriberFactory} from '@shipfox/node-module';
import {db, logsOutbox, migrationsPath} from '#db/index.js';
import {logsRoutes} from '#presentation/routes/index.js';
import {onJobTerminated} from '#presentation/subscribers/on-job-terminated.js';
import {createLogsActivities} from '#temporal/activities/index.js';
import {LOGS_LIFECYCLE_TASK_QUEUE} from '#temporal/constants.js';

export {checkBucketReachable} from '#api/object-storage.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflowsPath = resolve(packageRoot, 'dist/temporal/workflows/index.js');

const subscriber = subscriberFactory<WorkflowsEventMap>();

export const logsModule: ShipfoxModule = {
  name: 'logs',
  database: {db, migrationsPath},
  routes: logsRoutes,
  // `logs.stream.closed` is written by the close paths (drives compaction). The
  // job-terminated subscriber force-closes streams the runner never ended.
  publishers: [{name: 'logs', table: logsOutbox, db}],
  subscribers: [subscriber(WORKFLOWS_JOB_TERMINATED, onJobTerminated)],
  workers: [
    {
      taskQueue: LOGS_LIFECYCLE_TASK_QUEUE,
      workflowsPath,
      activities: createLogsActivities,
      workflows: [],
    },
  ],
};
