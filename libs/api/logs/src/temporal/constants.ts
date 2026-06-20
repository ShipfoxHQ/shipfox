export const LOGS_LIFECYCLE_TASK_QUEUE = 'logs-lifecycle';

// Compaction uploads can run for minutes; keeping them off the lifecycle queue stops a
// burst of large compactions from starving the short, time-sensitive close-abandoned sweep.
export const LOGS_COMPACTION_TASK_QUEUE = 'logs-compaction';

// Retention sweep tuning. The wall-clock budget is the real bound (well under the
// retention workflow's 5-minute startToCloseTimeout, so a slow run stops before the next
// cron run begins); the batch limit caps one keyset page, and max-iterations is a backstop
// against a non-advancing cursor.
export const RETENTION_BATCH_LIMIT = 200;
export const RETENTION_TIME_BUDGET_MS = 4 * 60_000;
export const RETENTION_MAX_ITERATIONS = 1_000;
