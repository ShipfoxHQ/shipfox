import {
  ActivityFailure,
  ApplicationFailure,
  log,
  patched,
  proxyActivities,
} from '@temporalio/workflow';
import {
  type DefinitionSyncDiagnostic,
  type DefinitionSyncErrorCode,
  isDefinitionSyncErrorCode,
} from '#core/entities/sync-state.js';
import type {
  createDefinitionSyncActivities,
  DiscoverDefinitionFilesActivityResult,
  SyncRefScopedInput,
} from '../activities/index.js';

export interface DefinitionSyncWorkflowInput {
  projectId: string;
  workspaceId: string;
  sourceConnectionId: string;
  sourceExternalRepositoryId: string;
  sourceRef?: string | undefined;
  sourceCommitSha?: string | undefined;
}

export interface DefinitionSyncWorkflowResult {
  sourceRef: string;
  appliedCount: number;
  deletedCount: number;
}

const PROVIDER_RETRY = {
  initialInterval: '5 seconds',
  backoffCoefficient: 2,
  maximumInterval: '1 minute',
  maximumAttempts: 5,
} as const;

const DB_RETRY = {
  initialInterval: '1 second',
  backoffCoefficient: 2,
  maximumInterval: '15 seconds',
  maximumAttempts: 5,
} as const;

const {
  prepareDefinitionSync,
  discoverDefinitionWorkflows,
  discoverDefinitionFiles,
  syncDefinitionAgents,
  fetchAndApplyDefinitionWorkflows,
  fetchAndApplyDefinitionWorkflowsV2,
} = proxyActivities<ReturnType<typeof createDefinitionSyncActivities>>({
  startToCloseTimeout: '5 minutes',
  heartbeatTimeout: '30 seconds',
  retry: PROVIDER_RETRY,
});

const {
  markDefinitionSyncSucceeded: markDefinitionSyncSucceededWithDiagnostics,
  markDefinitionSyncSucceededV2: markDefinitionSyncSucceededWithDiagnosticsV2,
  markDefinitionSyncFailed: markDefinitionSyncFailedWithDiagnostics,
  markDefinitionSyncFailedV2: markDefinitionSyncFailedWithDiagnosticsV2,
} = proxyActivities<ReturnType<typeof createDefinitionSyncActivities>>({
  startToCloseTimeout: '30 seconds',
  retry: DB_RETRY,
});

const legacyDefinitionSyncActivities = {
  fetchAndApply: fetchAndApplyDefinitionWorkflows,
  markSucceeded: markDefinitionSyncSucceededWithDiagnostics,
  markFailed: markDefinitionSyncFailedWithDiagnostics,
};
const structuredDefinitionSyncActivities = {
  fetchAndApply: fetchAndApplyDefinitionWorkflowsV2,
  markSucceeded: markDefinitionSyncSucceededWithDiagnosticsV2,
  markFailed: markDefinitionSyncFailedWithDiagnosticsV2,
};

export async function definitionSyncWorkflow(
  input: DefinitionSyncWorkflowInput,
): Promise<DefinitionSyncWorkflowResult> {
  let sourceRef: string | null = null;
  const structuredDiagnosticsEnabled = patched('definition-sync-diagnostics-v2');
  // Histories that began before agent files read the workflow folder alone.
  const agentsEnabled = patched('definition-sync-agents');
  const agentDiagnostics: DefinitionSyncDiagnostic[] = [];
  const {fetchAndApply, markSucceeded, markFailed} = structuredDiagnosticsEnabled
    ? structuredDefinitionSyncActivities
    : legacyDefinitionSyncActivities;

  try {
    const prepared = await prepareDefinitionSync(input);
    sourceRef = prepared.sourceRef;

    const source = {
      ...input,
      sourceRef: prepared.sourceRef,
      sourceCommitSha: prepared.sourceCommitSha,
    };
    const paths = agentsEnabled
      ? await discoverAndSyncAgents(source, agentDiagnostics)
      : (await discoverDefinitionWorkflows(source)).paths;
    const applied = await fetchAndApply({...source, paths});

    await markSucceeded({...source, diagnostics: [...applied.diagnostics, ...agentDiagnostics]});

    return {
      sourceRef,
      appliedCount: applied.appliedCount,
      deletedCount: applied.deletedCount,
    };
  } catch (error) {
    const {code, message, diagnostics} = classifyWorkflowError(error);
    // Retain the original patch call for histories created by the first diagnostics rollout.
    const legacyDiagnosticsEnabled = patched('definition-sync-diagnostics');
    const canPersistDiagnostics = structuredDiagnosticsEnabled || legacyDiagnosticsEnabled;
    if (diagnostics !== undefined && !canPersistDiagnostics) {
      log.warn('Definition sync diagnostics were not persisted for an existing workflow run', {
        code,
      });
    }
    try {
      await markFailed({
        ...input,
        sourceRef,
        code,
        message,
        ...(canPersistDiagnostics ? failureDiagnostics({diagnostics, agentDiagnostics}) : {}),
      });
    } catch (markFailedError) {
      const failureOptions = {
        message: `Definition sync failed with ${code}: ${message}; additionally failed to persist failure state: ${formatWorkflowError(markFailedError)}`,
        type: 'definition-sync-failure-persistence-failed',
        nonRetryable: true,
        details: [
          {
            syncFailureCode: code,
            syncFailureMessage: message,
            failurePersistenceMessage: formatWorkflowError(markFailedError),
          },
        ],
      };
      throw ApplicationFailure.create(
        error instanceof Error ? {...failureOptions, cause: error} : failureOptions,
      );
    }
    throw error;
  }
}

function failureDiagnostics(params: {
  diagnostics: DefinitionSyncDiagnostic[] | undefined;
  agentDiagnostics: DefinitionSyncDiagnostic[];
}): {diagnostics?: DefinitionSyncDiagnostic[]} {
  if (params.diagnostics === undefined && params.agentDiagnostics.length === 0) return {};
  return {diagnostics: [...(params.diagnostics ?? []), ...params.agentDiagnostics]};
}

/**
 * Lists both folders and syncs the agent files, then returns the workflow
 * paths. The agent diagnostics land in `agentDiagnostics` as soon as they
 * exist, so a later workflow failure still reports them.
 */
async function discoverAndSyncAgents(
  source: SyncRefScopedInput,
  agentDiagnostics: DefinitionSyncDiagnostic[],
): Promise<string[]> {
  const discovered = await discoverDefinitionFiles(source);
  agentDiagnostics.push(...(await syncAgentFiles(source, discovered)));
  return discovered.workflowPaths;
}

/**
 * Agent files never block workflow sync. A failure to read them becomes an
 * error diagnostic, and the agents keep their last stored version.
 */
async function syncAgentFiles(
  source: SyncRefScopedInput,
  discovered: DiscoverDefinitionFilesActivityResult,
): Promise<DefinitionSyncDiagnostic[]> {
  try {
    const synced = await syncDefinitionAgents({
      ...source,
      paths: discovered.agentPaths,
      nestedPaths: discovered.nestedAgentPaths,
      truncated: discovered.agentFilesTruncated,
    });
    return synced.diagnostics;
  } catch (error) {
    if (!(error instanceof ActivityFailure)) throw error;
    const {code, message} = classifyWorkflowError(error);
    log.warn('Agent files were not synced', {code});
    return [{code, message: `Agent files were not synced: ${message}`, severity: 'error'}];
  }
}

export function classifyWorkflowError(error: unknown): {
  code: DefinitionSyncErrorCode;
  message: string;
  diagnostics?: DefinitionSyncDiagnostic[] | undefined;
} {
  if (error instanceof ActivityFailure && error.cause instanceof ApplicationFailure) {
    return classifyWorkflowError(error.cause);
  }
  if (error instanceof ApplicationFailure) {
    const code = isDefinitionSyncErrorCode(error.type) ? error.type : 'unknown';
    const diagnostics = definitionSyncDiagnosticsFrom(error.details);
    return {
      code,
      message: error.message ?? code,
      ...(diagnostics.length === 0 ? {} : {diagnostics}),
    };
  }
  return {code: 'unknown', message: error instanceof Error ? error.message : String(error)};
}

function formatWorkflowError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function definitionSyncDiagnosticsFrom(
  details: readonly unknown[] | null | undefined,
): DefinitionSyncDiagnostic[] {
  const diagnostics = details?.[0];
  if (!Array.isArray(diagnostics)) return [];
  return diagnostics.filter(isDefinitionSyncDiagnostic);
}

function isDefinitionSyncDiagnostic(value: unknown): value is DefinitionSyncDiagnostic {
  if (typeof value !== 'object' || value === null) return false;

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.code === 'string' &&
    typeof candidate.message === 'string' &&
    (candidate.path === undefined || typeof candidate.path === 'string') &&
    (candidate.filePath === undefined || typeof candidate.filePath === 'string') &&
    (candidate.severity === 'error' || candidate.severity === 'warning')
  );
}
