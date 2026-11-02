export interface Definition {
  id: string;
  projectId: string;
  configPath: string | null;
  source: 'manual' | 'vcs';
  sha: string | null;
  ref: string | null;
  name: string;
  workflowDocument: unknown;
  workflowModel: unknown;
  manualTrigger: {name: string} | null;
  triggers: DefinitionTrigger[];
  fetchedAt: string;
  createdAt: string;
  updatedAt: string;
}

/** What starts a workflow, read from its model. */
export interface DefinitionTrigger {
  /** The trigger's name in the workflow file, unique within one workflow. */
  key: string;
  /** `manual`, `cron`, or the slug of the integration connection that emits the event. */
  source: string;
  /** Absent when the trigger listens to every event of its source. */
  event: string | null;
  /** The cron expression of a `cron` trigger. */
  schedule: string | null;
}

export interface DefinitionSyncSummary {
  ref: string | null;
  status: 'pending' | 'syncing' | 'succeeded' | 'failed';
  lastSyncAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  diagnostics: DefinitionSyncDiagnostic[];
}

export interface DefinitionSyncDiagnostic {
  code: string;
  message: string;
  path?: string | undefined;
  filePath?: string | undefined;
  severity: 'error' | 'warning';
}

export interface DefinitionList {
  definitions: Definition[];
  sync: DefinitionSyncSummary | null;
  nextCursor: string | null;
}
