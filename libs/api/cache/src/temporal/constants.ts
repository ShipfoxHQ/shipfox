export const CACHE_MAINTENANCE_TASK_QUEUE = 'cache-maintenance';

// The wall-clock budget is the real sweep bound; Temporal's timeout does not stop JS already
// running in the worker. It ends before the next 10-minute tick.
export const SWEEP_BATCH_LIMIT = 200;
export const SWEEP_TIME_BUDGET_MS = 8 * 60_000;

export const CACHE_STORAGE_SAMPLER_CRON_ID = 'cache-storage-sampler';
// Minute 5 leaves the top of the hour to the other hourly crons.
export const CACHE_STORAGE_SAMPLER_CRON_SCHEDULE = '5 * * * *';
