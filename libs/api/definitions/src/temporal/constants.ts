export const DEFINITIONS_TASK_QUEUE = 'definitions-sync';
export const DEFINITION_SYNC_WORKFLOW = 'definitionSyncWorkflow';
// Sync activities wait on provider and database calls, and a connection change
// resyncs every project of its workspace at once. Ten slots let that fan-out
// delay a new project's first activity past a minute.
export const DEFINITION_SYNC_MAX_CONCURRENT_ACTIVITIES = 50;
