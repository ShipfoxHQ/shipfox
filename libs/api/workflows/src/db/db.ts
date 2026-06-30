import {drizzle, type NodePgDatabase} from '@shipfox/node-drizzle';
import {pgClient} from '@shipfox/node-postgres';
import {jobExecutions} from './schema/job-executions.js';
import {jobs} from './schema/jobs.js';
import {workflowsOutbox} from './schema/outbox.js';
import {stepAttempts} from './schema/step-attempts.js';
import {steps} from './schema/steps.js';
import {workflowRuns} from './schema/workflow-runs.js';

export const schema = {workflowRuns, jobs, jobExecutions, steps, stepAttempts, workflowsOutbox};

let _db: NodePgDatabase<typeof schema> | undefined;

export function db() {
  if (!_db) _db = drizzle(pgClient(), {schema});
  return _db;
}

export function closeDb(): void {
  _db = undefined;
}

export type Tx = Parameters<Parameters<NodePgDatabase<typeof schema>['transaction']>[0]>[0];

// Lets callers express a unit of work to run atomically without depending on the
// db() singleton or drizzle's transaction API directly.
export function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db().transaction(fn);
}
