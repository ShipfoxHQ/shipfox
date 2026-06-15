export const INTEGRATIONS_MAINTENANCE_TASK_QUEUE = 'integrations-maintenance';

export const WEBHOOK_DELIVERY_RETENTION_DAYS = 30;

// How long a verified Sentry install may sit unclaimed before the TTL cron
// tombstones it. Bounds a never-finished install instead of leaving it pending
// forever; a reinstall always mints a fresh uuid, so a tombstone is never revived.
export const SENTRY_UNCLAIMED_INSTALLATION_RETENTION_DAYS = 7;
