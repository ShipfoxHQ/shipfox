export const SHIPFOX_PROVIDER = 'shipfox' as const;

export const SHIPFOX_BUILTIN_CONNECTION_ID = '00000000-0000-4000-8000-000000000001' as const;

export const SHIPFOX_RUN_REQUESTED_EVENT = 'run.requested' as const;
export const SHIPFOX_RUN_STARTED_EVENT = 'run.started' as const;
export const SHIPFOX_RUN_COMPLETED_EVENT = 'run.completed' as const;
export const SHIPFOX_JOB_QUEUED_EVENT = 'job.queued' as const;
export const SHIPFOX_JOB_STARTED_EVENT = 'job.started' as const;
export const SHIPFOX_JOB_COMPLETED_EVENT = 'job.completed' as const;

export const shipfoxEventNames = [
  SHIPFOX_RUN_REQUESTED_EVENT,
  SHIPFOX_RUN_STARTED_EVENT,
  SHIPFOX_RUN_COMPLETED_EVENT,
  SHIPFOX_JOB_QUEUED_EVENT,
  SHIPFOX_JOB_STARTED_EVENT,
  SHIPFOX_JOB_COMPLETED_EVENT,
] as const;

export type ShipfoxEventName = (typeof shipfoxEventNames)[number];
