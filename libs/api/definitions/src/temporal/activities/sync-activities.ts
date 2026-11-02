import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import type {RegistryInterModuleClient} from '@shipfox/api-registry-dto/inter-module';
import {markErrorReported} from '@shipfox/node-error-monitoring';
import type {FeatureFlags} from '@shipfox/node-feature-flags';
import {Context} from '@temporalio/activity';
import {ApplicationFailure} from '@temporalio/common';
import {readActionSupport} from '#core/action-support.js';
import {
  type DefinitionSyncDiagnostic,
  type DefinitionSyncErrorCode,
  limitDefinitionSyncDiagnostics,
} from '#core/entities/sync-state.js';
import {
  classifySyncFailure,
  discoverWorkflowFiles,
  fetchAndParseWorkflows,
  resolveSyncSource,
  UNRESOLVED_SYNC_REF,
} from '#core/index.js';
import type {DefinitionsSourceControl} from '#core/integrations.js';
import {loadIntegrationValidationContext} from '#core/integrations.js';
import {
  applyVcsDefinitionsBatch,
  markDefinitionSyncState,
  moveVcsDefinitionsToRef,
  upsertActionSnapshot,
} from '#db/index.js';

export interface SyncWorkflowInput {
  projectId: string;
  workspaceId: string;
  sourceConnectionId: string;
  sourceExternalRepositoryId: string;
  sourceRef?: string | undefined;
  sourceCommitSha?: string | undefined;
}

export interface SyncRefScopedInput extends SyncWorkflowInput {
  sourceRef: string;
}

export interface FetchAndApplyActivityInput extends SyncRefScopedInput {
  paths: string[];
}

export interface MarkSyncFailedActivityInput extends Omit<SyncWorkflowInput, 'sourceRef'> {
  sourceRef: string | null;
  code: DefinitionSyncErrorCode;
  message: string;
  diagnostics?: readonly DefinitionSyncDiagnostic[] | undefined;
}

export interface PrepareSyncResult {
  sourceRef: string;
  sourceCommitSha?: string | undefined;
}

export interface DiscoverWorkflowsActivityResult {
  paths: string[];
}

export interface FetchAndApplyActivityResult {
  appliedCount: number;
  deletedCount: number;
  diagnostics: DefinitionSyncDiagnostic[];
}

export interface MarkSyncSucceededActivityInput extends SyncRefScopedInput {
  diagnostics?: readonly DefinitionSyncDiagnostic[] | undefined;
}

export interface DefinitionSyncActivityOptions {
  workflowPath: string;
  /** Resolves registry actions during sync. */
  registry?: Pick<RegistryInterModuleClient, 'resolveVersion'> | undefined;
  /** Reads the `definitions-actions` flag per workspace. Without it, the flag's default applies. */
  flags?: FeatureFlags | undefined;
}

export function createDefinitionSyncActivities(
  sourceControl: DefinitionsSourceControl,
  agent: AgentInterModuleClient,
  projects: Pick<ProjectsModuleClient, 'getProjectById'>,
  integrations?: IntegrationsModuleClient | undefined,
  options?: DefinitionSyncActivityOptions | undefined,
) {
  const fetchAndApplyDefinitionWorkflows = createFetchAndApplyActivity(
    sourceControl,
    agent,
    projects,
    integrations,
    options?.registry,
    options?.flags,
  );
  const markDefinitionSyncSucceeded = createMarkSyncSucceededActivity();
  const markDefinitionSyncFailed = createMarkSyncFailedActivity();

  return {
    prepareDefinitionSync: createPrepareDefinitionSyncActivity(sourceControl, projects),
    discoverDefinitionWorkflows: createDiscoverDefinitionWorkflowsActivity(
      sourceControl,
      options?.workflowPath,
    ),
    fetchAndApplyDefinitionWorkflows,
    // Versioned names keep old workers from silently dropping diagnostics.
    fetchAndApplyDefinitionWorkflowsV2: fetchAndApplyDefinitionWorkflows,
    markDefinitionSyncSucceeded,
    markDefinitionSyncSucceededV2: markDefinitionSyncSucceeded,
    markDefinitionSyncFailed,
    markDefinitionSyncFailedV2: markDefinitionSyncFailed,
  };
}

/**
 * A sync is superseded once its project points at another source, or is gone.
 * It must then change nothing, or it could move rows back to its old ref or
 * delete rows from the new source. The read is not transactional: a move
 * happens once per project, so the remaining window is accepted.
 */
async function isSyncSuperseded(
  projects: Pick<ProjectsModuleClient, 'getProjectById'>,
  input: SyncWorkflowInput,
): Promise<boolean> {
  const {project} = await projects.getProjectById({projectId: input.projectId});
  return (
    project === null ||
    project.sourceConnectionId !== input.sourceConnectionId ||
    project.sourceExternalRepositoryId !== input.sourceExternalRepositoryId
  );
}

function createPrepareDefinitionSyncActivity(
  sourceControl: DefinitionsSourceControl,
  projects: Pick<ProjectsModuleClient, 'getProjectById'>,
) {
  return async function prepareDefinitionSync(
    input: SyncWorkflowInput,
  ): Promise<PrepareSyncResult> {
    return await runWithPermanentTranslation(async () => {
      const sourceRef = input.sourceRef ?? (await resolveSyncSource({...input, sourceControl})).ref;

      await markDefinitionSyncState({
        projectId: input.projectId,
        sourceConnectionId: input.sourceConnectionId,
        sourceExternalRepositoryId: input.sourceExternalRepositoryId,
        ref: sourceRef,
        status: 'syncing',
        lastErrorCode: null,
        lastErrorMessage: null,
        diagnostics: [],
        startedAt: new Date(),
        finishedAt: null,
      });

      // Live rows follow the default branch, so lookups by it keep answering while a first sync on a new source fails.
      if (!(await isSyncSuperseded(projects, input))) {
        await moveVcsDefinitionsToRef({
          projectId: input.projectId,
          workspaceId: input.workspaceId,
          ref: sourceRef,
        });
      }

      return {sourceRef, sourceCommitSha: input.sourceCommitSha};
    });
  };
}

function createDiscoverDefinitionWorkflowsActivity(
  sourceControl: DefinitionsSourceControl,
  workflowPath?: string | undefined,
) {
  return async function discoverDefinitionWorkflows(
    input: SyncRefScopedInput,
  ): Promise<DiscoverWorkflowsActivityResult> {
    return await runWithPermanentTranslation(async () => {
      return await discoverWorkflowFiles({
        ...input,
        ref: input.sourceCommitSha ?? input.sourceRef,
        sourceControl,
        workflowPath,
      });
    });
  };
}

function createFetchAndApplyActivity(
  sourceControl: DefinitionsSourceControl,
  agent: AgentInterModuleClient,
  projects: Pick<ProjectsModuleClient, 'getProjectById'>,
  integrations?: IntegrationsModuleClient | undefined,
  registry?: Pick<RegistryInterModuleClient, 'resolveVersion'> | undefined,
  flags?: FeatureFlags | undefined,
) {
  return async function fetchAndApplyDefinitionWorkflows(
    input: FetchAndApplyActivityInput,
  ): Promise<FetchAndApplyActivityResult> {
    return await runWithPermanentTranslation(async () => {
      const actionSupport = await readActionSupport({flags, workspaceId: input.workspaceId});
      const {workflows, actions, actionDiagnostics} = await fetchAndParseWorkflows({
        ...input,
        ...actionSupport,
        ref: input.sourceCommitSha ?? input.sourceRef,
        sourceControl,
        registry,
        agentValidationCatalog: await agent.getValidationCatalogV2({
          workspaceId: input.workspaceId,
        }),
        onProgress: (path) => Context.current().heartbeat({path}),
        loadIntegrationValidationContext:
          integrations === undefined
            ? undefined
            : async () => {
                return await loadIntegrationValidationContext(
                  integrations,
                  input.workspaceId,
                  input.sourceConnectionId,
                );
              },
      });

      if (await isSyncSuperseded(projects, input)) {
        return {appliedCount: 0, deletedCount: 0, diagnostics: []};
      }

      // Snapshots go first, so every stored definition can resolve its digests.
      for (const action of actions) {
        await upsertActionSnapshot({
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          manifest: action.manifest,
          bundle: action.bundle,
          source: action.registry === undefined ? 'vcs' : 'registry',
        });
      }

      const result = await applyVcsDefinitionsBatch({
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        ref: input.sourceRef,
        upserts: workflows.map((entry) => ({
          configPath: entry.path,
          name: entry.name,
          document: entry.definition.document,
          model: entry.definition.model,
          sourceSnapshot: entry.definition.sourceSnapshot,
          contentHash: entry.contentHash,
          registryRefs: entry.registryRefs,
        })),
      });

      const diagnostics = limitDefinitionSyncDiagnostics([
        ...workflows.flatMap((entry) =>
          entry.diagnostics.map((diagnostic) => ({...diagnostic, filePath: entry.path})),
        ),
        ...actionDiagnostics,
      ]);

      return {
        ...result,
        diagnostics,
      };
    });
  };
}

function createMarkSyncSucceededActivity() {
  return async function markDefinitionSyncSucceeded(
    input: MarkSyncSucceededActivityInput,
  ): Promise<void> {
    await markDefinitionSyncState({
      projectId: input.projectId,
      sourceConnectionId: input.sourceConnectionId,
      sourceExternalRepositoryId: input.sourceExternalRepositoryId,
      ref: input.sourceRef,
      status: 'succeeded',
      lastErrorCode: null,
      lastErrorMessage: null,
      diagnostics: input.diagnostics ?? [],
      finishedAt: new Date(),
    });
  };
}

function createMarkSyncFailedActivity() {
  return async function markDefinitionSyncFailed(
    input: MarkSyncFailedActivityInput,
  ): Promise<void> {
    await markDefinitionSyncState({
      projectId: input.projectId,
      sourceConnectionId: input.sourceConnectionId,
      sourceExternalRepositoryId: input.sourceExternalRepositoryId,
      ref: input.sourceRef ?? UNRESOLVED_SYNC_REF,
      status: 'failed',
      lastErrorCode: input.code,
      lastErrorMessage: input.message,
      diagnostics: input.diagnostics ?? [],
      finishedAt: new Date(),
    });
  };
}

async function runWithPermanentTranslation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ApplicationFailure) {
      throw error;
    }
    const failure = classifySyncFailure(error);
    const details = failure.diagnostics === undefined ? [] : [failure.diagnostics];
    const translatedError = failure.retryable
      ? ApplicationFailure.retryable(failure.message, failure.code, ...details)
      : ApplicationFailure.nonRetryable(failure.message, failure.code, ...details);
    if (failure.code !== 'unknown') markErrorReported(translatedError);
    throw translatedError;
  }
}
