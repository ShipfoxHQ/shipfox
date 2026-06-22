export const LOGS_LIFECYCLE_TASK_QUEUE = 'logs-lifecycle';

// Compaction uploads can run for minutes; keeping them off the lifecycle queue stops a
// burst of large compactions from starving the short, time-sensitive close-abandoned sweep.
export const LOGS_COMPACTION_TASK_QUEUE = 'logs-compaction';

// The wall-clock budget is the real sweep bound; Temporal's timeout does not stop JS already
// running in the worker.
export const RETENTION_BATCH_LIMIT = 200;
export const RETENTION_TIME_BUDGET_MS = 4 * 60_000;
export const RETENTION_MAX_ITERATIONS = 1_000;

// Bounded per tick; remaining stale open streams are picked up on the next cron run.
export const REAP_BATCH_LIMIT = 100;
