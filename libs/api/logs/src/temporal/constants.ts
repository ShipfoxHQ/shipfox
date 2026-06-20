export const LOGS_LIFECYCLE_TASK_QUEUE = 'logs-lifecycle';

// Compaction uploads can run for minutes; keeping them off the lifecycle queue stops a
// burst of large compactions from starving the short, time-sensitive close-abandoned sweep.
export const LOGS_COMPACTION_TASK_QUEUE = 'logs-compaction';
