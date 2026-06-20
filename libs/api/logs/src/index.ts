import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {LOG_STREAM_CLOSED, type LogsEventMap} from '@shipfox/api-logs-dto';
import {WORKFLOWS_JOB_TERMINATED, type WorkflowsEventMap} from '@shipfox/api-workflows-dto';
import {type ShipfoxModule, subscriberFactory} from '@shipfox/node-module';
import {db, logsOutbox, migrationsPath} from '#db/index.js';
import {logsRoutes} from '#presentation/routes/index.js';
import {onJobTerminated} from '#presentation/subscribers/on-job-terminated.js';
import {onLogStreamClosed} from '#presentation/subscribers/on-log-stream-closed.js';
import {createLogsActivities} from '#temporal/activities/index.js';
import {LOGS_COMPACTION_TASK_QUEUE, LOGS_LIFECYCLE_TASK_QUEUE} from '#temporal/constants.js';

export {checkBucketReachable} from '#api/object-storage.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflowsPath = resolve(packageRoot, 'dist/temporal/workflows/index.js');

const subscriber = subscriberFactory<WorkflowsEventMap & LogsEventMap>();

export const logsModule: ShipfoxModule = {
  name: 'logs',
  database: {db, migrationsPath},
  routes: logsRoutes,
  // `logs.stream.closed` is written by the close paths: the job-terminated subscriber
  // force-closes streams the runner never ended, and the closed event drives compaction.
  publishers: [{name: 'logs', table: logsOutbox, db}],
  subscribers: [
    subscriber(WORKFLOWS_JOB_TERMINATED, onJobTerminated),
    subscriber(LOG_STREAM_CLOSED, onLogStreamClosed),
  ],
  workers: [
    {
      taskQueue: LOGS_LIFECYCLE_TASK_QUEUE,
      workflowsPath,
      activities: createLogsActivities,
      // Retention is a fast lifecycle sweep (each run drains what fits in its time budget). The
      // cadence is hard-coded, not configurable: a Temporal cron schedule is fixed when the
      // workflow is first created and the module bootstrap skips an already-running one, so an env
      // knob would look adjustable but silently keep the old schedule. Hourly is ample headroom for
      // a 90-day horizon; tune LOG_RETENTION_DAYS for the horizon itself.
      workflows: [
        {
          name: 'retentionSweepCron',
          id: 'logs-retention-sweep',
          cronSchedule: '0 * * * *',
        },
      ],
    },
    // Compaction runs on its own queue so long uploads cannot starve the lifecycle sweep.
    {
      taskQueue: LOGS_COMPACTION_TASK_QUEUE,
      workflowsPath,
      activities: createLogsActivities,
      workflows: [
        {
          name: 'compactionReconcileCron',
          id: 'logs-compaction-reconcile',
          cronSchedule: '*/10 * * * *',
        },
      ],
    },
  ],
};
