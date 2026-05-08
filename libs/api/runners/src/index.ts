import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {WORKFLOWS_JOB_TIMED_OUT} from '@shipfox/api-workflows-dto';
import type {ShipfoxModule} from '@shipfox/node-module';
import {db, migrationsPath, runnersOutbox} from '#db/index.js';
import {createRunnerTokenAuthMethod, onWorkflowsJobTimedOut, routes} from '#presentation/index.js';
import {createRunnersMaintenanceActivities} from '#temporal/activities/index.js';
import {RUNNERS_MAINTENANCE_TASK_QUEUE} from '#temporal/constants.js';

// Public surface intentionally tiny:
// - `runnersModule` is how the app composes this bounded context.
// - `enqueueJob` is the documented synchronous Workflows → Runners command
//   (see .claude/research/system-design.md). Workflows hands a job over to
//   the runner queue via this call; everything else flows through events.
// Anything else is internal and reachable only via `#db/...`, `#core/...`,
// or `#presentation/...` from inside the package.
export {enqueueJob} from '#db/index.js';

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
