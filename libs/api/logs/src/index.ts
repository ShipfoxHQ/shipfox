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
      // Temporal cron schedules are fixed after creation, so making cadence configurable would
      // look adjustable while keeping the old schedule. Tune LOG_RETENTION_DAYS for the horizon.
      workflows: [
        {
          name: 'retentionSweepCron',
          id: 'logs-retention-sweep',
          cronSchedule: '0 * * * *',
        },
        // Backstop for the one-shot job-terminated close: force-closes streams left open past the
        // lease window (tune LOG_STREAM_REAP_AFTER_SECONDS). Runs every 10 minutes so a leak burst
        // cannot pile up, on an offset minute so it does not land on retention's top-of-hour run.
        {
          name: 'reapStaleOpenStreamsCron',
          id: 'logs-reap-stale-open-streams',
          cronSchedule: '5,15,25,35,45,55 * * * *',
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
