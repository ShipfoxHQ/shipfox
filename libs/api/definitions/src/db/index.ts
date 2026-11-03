import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export {
  getActionSnapshot,
  type UpsertActionSnapshotParams,
  upsertActionSnapshot,
} from './action-snapshots.js';
export {
  type ApplyProjectAgentsParams,
  type ApplyProjectAgentsResult,
  applyProjectAgents,
  listProjectAgents,
  type ProjectAgentFile,
} from './agents.js';
export {closeDb, db, schema} from './db.js';
export type {
  ApplyVcsDefinitionsBatchParams,
  ApplyVcsDefinitionsBatchResult,
  ListDefinitionsParams,
  ListDefinitionsResult,
  SoftDeleteVcsDefinitionsParams,
  StoredWorkflowDefinitionHistoricalEventPayloadAudit,
  UpsertDefinitionParams,
} from './definitions.js';
export {
  applyVcsDefinitionsBatch,
  auditStoredDefinitions,
  findOrCreateWorkflowLineage,
  getDefinitionByConfigPath,
  getDefinitionById,
  invalidateCache,
  listDefinitions,
  listDefinitionsByProject,
  moveVcsDefinitionsToRef,
  softDeleteVcsDefinitionsNotIn,
  upsertDefinition,
} from './definitions.js';
export {definitionActionSnapshots} from './schema/action-snapshots.js';
export {definitionAgents} from './schema/agents.js';
export {definitionsOutbox} from './schema/outbox.js';
export {definitionSyncStates} from './schema/sync-states.js';
export {type WorkflowCreateDb, type WorkflowDb, workflowWorkflows} from './schema/workflows.js';
export {
  type DefinitionSyncStateKey,
  getLatestDefinitionSyncState,
  type MarkDefinitionSyncParams,
  markDefinitionSyncState,
} from './sync-states.js';

export const migrationsPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');
