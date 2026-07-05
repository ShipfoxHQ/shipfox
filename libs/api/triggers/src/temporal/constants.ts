export const TRIGGERS_MAINTENANCE_TASK_QUEUE = 'triggers-maintenance';

/**
 * Dedicated queue for the minute cron tick, so bursty cron-fire load and hourly
 * maintenance load scale independently.
 */
export const TRIGGERS_CRON_TASK_QUEUE = 'triggers-cron';
