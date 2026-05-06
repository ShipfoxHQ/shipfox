export type DefinitionSyncStatus = 'pending' | 'syncing' | 'succeeded' | 'failed';

export const DEFINITION_SYNC_ERROR_CODES = [
  'no-workflow-files',
  'invalid-definition',
  'provider-repository-not-found',
  'provider-file-not-found',
  'provider-access-denied',
  'provider-rate-limited',
  'provider-timeout',
  'provider-unavailable',
  'provider-malformed-response',
  'content-too-large',
  'too-many-files',
  'connection-unavailable',
  'unknown',
] as const;

export type DefinitionSyncErrorCode = (typeof DEFINITION_SYNC_ERROR_CODES)[number];

export function isDefinitionSyncErrorCode(value: unknown): value is DefinitionSyncErrorCode {
  return (
    typeof value === 'string' && (DEFINITION_SYNC_ERROR_CODES as readonly string[]).includes(value)
  );
}

export interface DefinitionSyncState {
  id: string;
  projectId: string;
  sourceConnectionId: string;
  sourceExternalRepositoryId: string;
  ref: string;
  status: DefinitionSyncStatus;
  lastErrorCode: DefinitionSyncErrorCode | null;
  lastErrorMessage: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
