import {createHash} from 'node:crypto';
import type {AgentValidationCatalogV2} from '@shipfox/api-agent-dto/inter-module';
import {MAX_WORKFLOW_FILE_BYTES} from '@shipfox/api-definitions-dto';
import {integrationsInterModuleContract} from '@shipfox/api-integration-core-dto/inter-module';
import {
  type RegistryInterModuleClient,
  registryInterModuleContract,
} from '@shipfox/api-registry-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {boundedMap} from '@shipfox/node-module';
import type {WorkflowDocument} from '@shipfox/workflow-document';
import {actionSupportFor} from './action-support.js';
import {checkActionImports} from './check-action-imports.js';
import {collectActionReferences} from './collect-action-references.js';
import {collectPromptFilePaths} from './collect-prompt-file-references.js';
import {collectRegistryRefs} from './collect-registry-refs.js';
import type {ResolvedActions} from './entities/action-snapshot.js';
import type {IntegrationValidationContext} from './entities/integration-context.js';
import type {RegistryRef} from './entities/registry-ref.js';
import {
  type DefinitionSyncDiagnostic,
  type DefinitionSyncErrorCode,
  limitDefinitionSyncDiagnostics,
} from './entities/sync-state.js';
import type {ValidationDiagnostic} from './entities/validation-diagnostic.js';
import type {WorkflowDefinitionPayload} from './entities/workflow-definition.js';
import {
  ActionResolutionError,
  DefinitionParseError,
  DefinitionSyncPermanentError,
  PromptFileResolutionError,
} from './errors.js';
import {
  type DefinitionsSourceControl,
  FILE_FETCH_CONCURRENCY,
  isBinaryFileError,
} from './integrations.js';
import {needsIntegrationValidationContext} from './needs-integration-validation-context.js';
import {parseDefinitionWithDiagnostics, stripDefinitionDiagnostics} from './parse-definition.js';
import {
  type ResolvedAction,
  resolveWorkflowActions,
  summarizeResolvedActions,
} from './resolve-actions.js';
import {resolvePromptFiles} from './resolve-prompt-files.js';
import type {ValidationError} from './validate-definition.js';
import {parseWorkflowYaml} from './workflow-yaml/index.js';

export const DEFAULT_WORKFLOW_PATH = '.shipfox/workflows/';
export const MAX_WORKFLOW_FILES = 100;
export {MAX_WORKFLOW_FILE_BYTES};
export const UNRESOLVED_SYNC_REF = '__unresolved__';
const TRAILING_SENTENCE_PUNCTUATION_RE = /[.!?]$/;

export interface SyncSourceContext {
  workspaceId: string;
  sourceConnectionId: string;
  sourceExternalRepositoryId: string;
  sourceControl: DefinitionsSourceControl;
}

export interface ResolvedSyncSource {
  ref: string;
}

export async function resolveSyncSource(params: SyncSourceContext): Promise<ResolvedSyncSource> {
  const source = await params.sourceControl.resolveRepository({
    workspaceId: params.workspaceId,
    connectionId: params.sourceConnectionId,
    externalRepositoryId: params.sourceExternalRepositoryId,
  });
  return {ref: source.repository.defaultBranch};
}

export interface DiscoverWorkflowFilesParams extends SyncSourceContext {
  ref: string;
  workflowPath?: string | undefined;
}

export async function discoverWorkflowFiles(
  params: DiscoverWorkflowFilesParams,
): Promise<{paths: string[]}> {
  const workflowPath = params.workflowPath ?? DEFAULT_WORKFLOW_PATH;
  const page = await params.sourceControl.listFiles({
    workspaceId: params.workspaceId,
    connectionId: params.sourceConnectionId,
    externalRepositoryId: params.sourceExternalRepositoryId,
    ref: params.ref,
    prefix: workflowPath,
    limit: MAX_WORKFLOW_FILES,
  });
  if (page.nextCursor) {
    throw new DefinitionSyncPermanentError(
      'too-many-files',
      `More than ${MAX_WORKFLOW_FILES} workflow files were found`,
    );
  }

  const paths = page.files.filter(isWorkflowFile).map((file) => file.path);
  if (paths.length === 0) {
    throw new DefinitionSyncPermanentError(
      'no-workflow-files',
      `No workflow files were found under ${workflowPath}`,
    );
  }

  return {paths};
}

export function isWorkflowFile(file: {path: string; type: string}): boolean {
  return file.type === 'file' && (file.path.endsWith('.yml') || file.path.endsWith('.yaml'));
}

export interface ParsedWorkflow {
  path: string;
  name: string;
  definition: WorkflowDefinitionPayload;
  contentHash: string;
  /** The registry actions and template the file uses. */
  registryRefs: RegistryRef[];
  diagnostics: ValidationDiagnostic[];
}

export interface FetchAndParseWorkflowsParams extends SyncSourceContext {
  ref: string;
  paths: string[];
  /** Called before each workflow file and each action directory is read. */
  onProgress?: ((path: string) => void) | undefined;
  agentValidationCatalog: AgentValidationCatalogV2;
  loadIntegrationValidationContext?: (() => Promise<IntegrationValidationContext>) | undefined;
  /** Accepts action steps (`uses`). Defaults to off; read the `definitions-actions` flag to set it. */
  actionsEnabled?: boolean | undefined;
  /**
   * Accepts registry references in `uses`. Defaults to on when `actionsEnabled`
   * is on and `REGISTRY_URL` is set.
   */
  registryActionsEnabled?: boolean | undefined;
  /** Resolves registry actions. Without it, a registry reference fails sync. */
  registry?: Pick<RegistryInterModuleClient, 'resolveVersion'> | undefined;
}

export interface ParsedWorkflows {
  workflows: ParsedWorkflow[];
  /** Every action the workflows reference, once per `uses` path. */
  actions: ResolvedAction[];
  /** Warnings on action files, which belong to no workflow file. */
  actionDiagnostics: DefinitionSyncDiagnostic[];
}

/**
 * Reads the workflows, the actions they reference, and their prompt files at
 * `ref`, which is a commit SHA when sync runs for a push, so code, prompts, and
 * workflow come from one tree.
 */
export async function fetchAndParseWorkflows(
  params: FetchAndParseWorkflowsParams,
): Promise<ParsedWorkflows> {
  const support = actionSupportFor(params.actionsEnabled ?? false);
  const actionsEnabled = support.actionsEnabled;
  const registryActionsEnabled = params.registryActionsEnabled ?? support.registryActionsEnabled;
  const fetched = await boundedMap(
    params.paths,
    FILE_FETCH_CONCURRENCY,
    async (path) => {
      params.onProgress?.(path);

      const snapshot = await fetchWorkflowFile(params, path);

      if (Buffer.byteLength(snapshot.content, 'utf8') > MAX_WORKFLOW_FILE_BYTES) {
        throw new DefinitionSyncPermanentError(
          'content-too-large',
          `Workflow file is larger than ${MAX_WORKFLOW_FILE_BYTES} bytes: ${snapshot.path}`,
        );
      }

      return {path: snapshot.path, content: snapshot.content};
    },
    {stopOnError: true},
  );

  // Pass 1 needs only the documents: which actions to read and whether the
  // integration context is needed.
  const documents = fetched.map((entry) => ({
    ...entry,
    document: parseWorkflowDocumentForSync({
      ...entry,
      agentValidationCatalog: params.agentValidationCatalog,
      actionsEnabled,
      registryActionsEnabled,
    }),
  }));

  const resolvedActions = await resolveSyncActions(params, documents);
  const actionManifests = summarizeResolvedActions(resolvedActions);
  const promptFiles = await resolveSyncPromptFiles(params, documents);

  const integrationValidationContext =
    params.loadIntegrationValidationContext !== undefined &&
    documents.some((entry) => needsIntegrationValidationContext(entry.document, actionManifests))
      ? await params.loadIntegrationValidationContext()
      : undefined;

  const workflows = documents.map((entry) => {
    const parsed = parseWorkflowSnapshot({
      path: entry.path,
      content: entry.content,
      agentValidationCatalog: params.agentValidationCatalog,
      integrationValidationContext,
      actionsEnabled,
      registryActionsEnabled,
      actionManifests,
      promptFiles,
    });
    return {
      ...parsed,
      contentHash: workflowContentHash({
        content: entry.content,
        document: entry.document,
        actionManifests,
        promptFiles,
      }),
      registryRefs: collectRegistryRefs({content: entry.content, document: entry.document}),
    };
  });

  const actions = [...resolvedActions.values()];
  return {workflows, actions, actionDiagnostics: await actionImportDiagnostics(actions)};
}

function parseWorkflowDocumentForSync(params: {
  path: string;
  content: string;
  agentValidationCatalog: AgentValidationCatalogV2;
  actionsEnabled: boolean;
  registryActionsEnabled: boolean;
}): WorkflowDocument {
  try {
    return parseWorkflowYaml(params.content, {
      actions: params.actionsEnabled,
      registryActions: params.registryActionsEnabled,
    });
  } catch (error) {
    // Full validation fails the same way and reports the failure with its
    // details, before any action is read.
    parseWorkflowSnapshot({...params, actionManifests: new Map()});
    const reason = error instanceof Error ? error.message : String(error);
    throw new DefinitionSyncPermanentError(
      'invalid-definition',
      `Invalid workflow definition at ${params.path}: ${reason}`,
      [],
      params.path,
    );
  }
}

async function resolveSyncActions(
  params: FetchAndParseWorkflowsParams,
  workflows: readonly {path: string; document: WorkflowDocument}[],
): Promise<Map<string, ResolvedAction>> {
  try {
    return await resolveWorkflowActions({...params, workflows});
  } catch (error) {
    if (!(error instanceof ActionResolutionError)) throw error;
    const details =
      error.details.length === 0 && error.filePath !== undefined
        ? [{message: error.message}]
        : error.details;
    throw new DefinitionSyncPermanentError(error.code, error.message, details, error.filePath);
  }
}

async function resolveSyncPromptFiles(
  params: FetchAndParseWorkflowsParams,
  workflows: readonly {path: string; document: WorkflowDocument}[],
): Promise<Map<string, string>> {
  try {
    return await resolvePromptFiles({...params, workflows});
  } catch (error) {
    if (!(error instanceof PromptFileResolutionError)) throw error;
    throw new DefinitionSyncPermanentError(
      'prompt-file-invalid',
      error.message,
      [{message: error.message, path: error.path}],
      error.filePath,
    );
  }
}

/**
 * Hashes the YAML alone when the workflow uses no action and no prompt file, so
 * existing rows keep their hash. Otherwise the action digests and the prompt
 * file digests join the hash, so a commit that changes only action code or only
 * a prompt file still produces a new definition.
 */
function workflowContentHash(params: {
  content: string;
  document: WorkflowDocument;
  actionManifests: ResolvedActions;
  promptFiles: ReadonlyMap<string, string>;
}): string {
  const uses = collectActionReferences(params.document);
  const files = collectPromptFilePaths(params.document);
  if (uses.length === 0 && files.length === 0) return sha256Hex(params.content);

  const actions = uses
    .sort()
    .map((path) => [path, params.actionManifests.get(path)?.digest ?? null]);
  if (files.length === 0) return sha256Hex(JSON.stringify({content: params.content, actions}));

  const promptFiles = files.map((path) => [path, sha256Hex(params.promptFiles.get(path) ?? '')]);
  return sha256Hex(JSON.stringify({content: params.content, actions, promptFiles}));
}

async function actionImportDiagnostics(
  actions: readonly ResolvedAction[],
): Promise<DefinitionSyncDiagnostic[]> {
  const diagnostics: DefinitionSyncDiagnostic[] = [];
  for (const action of actions) {
    // Registry actions are bundled, and the runner loads them strictly.
    if (action.registry !== undefined) continue;
    const directory = action.uses.slice('./'.length);
    for (const issue of await checkActionImports({files: action.files})) {
      diagnostics.push({
        code: issue.code,
        message: issue.message,
        severity: 'warning',
        filePath: `${directory}/${issue.filePath}`,
      });
    }
  }
  return diagnostics;
}

async function fetchWorkflowFile(params: FetchAndParseWorkflowsParams, path: string) {
  try {
    return await params.sourceControl.fetchFile({
      workspaceId: params.workspaceId,
      connectionId: params.sourceConnectionId,
      externalRepositoryId: params.sourceExternalRepositoryId,
      ref: params.ref,
      path,
    });
  } catch (error) {
    if (isBinaryFileError(error)) {
      const message = `Workflow file is not UTF-8 text: ${path}`;
      throw new DefinitionSyncPermanentError('invalid-definition', message, [{message}], path);
    }
    throw error;
  }
}

function parseWorkflowSnapshot(params: {
  path: string;
  content: string;
  integrationValidationContext?: IntegrationValidationContext | undefined;
  agentValidationCatalog: AgentValidationCatalogV2;
  actionsEnabled: boolean;
  registryActionsEnabled: boolean;
  actionManifests: ResolvedActions;
  promptFiles?: ReadonlyMap<string, string> | undefined;
}): Omit<ParsedWorkflow, 'contentHash' | 'registryRefs'> {
  try {
    const definition = parseDefinitionWithDiagnostics(params.content, {
      agentValidationCatalog: params.agentValidationCatalog,
      actionsEnabled: params.actionsEnabled,
      registryActionsEnabled: params.registryActionsEnabled,
      actionManifests: params.actionManifests,
      ...(params.promptFiles === undefined ? {} : {promptFiles: params.promptFiles}),
      ...(params.integrationValidationContext === undefined
        ? {}
        : {integrationValidationContext: params.integrationValidationContext}),
    });
    return {
      path: params.path,
      name: definition.document.name,
      definition: stripDefinitionDiagnostics(definition),
      diagnostics: definition.diagnostics,
    };
  } catch (error) {
    if (error instanceof DefinitionParseError) {
      throw new DefinitionSyncPermanentError(
        'invalid-definition',
        `Invalid workflow definition at ${params.path}: ${error.message}`,
        validationErrorsFrom(error.details),
        params.path,
      );
    }
    throw error;
  }
}

export interface SyncFailureClassification {
  code: DefinitionSyncErrorCode;
  message: string;
  retryable: boolean;
  diagnostics?: DefinitionSyncDiagnostic[] | undefined;
}

export function classifySyncFailure(error: unknown): SyncFailureClassification {
  if (error instanceof DefinitionSyncPermanentError) {
    const diagnostics = definitionSyncDiagnosticsFor({
      code: error.code,
      errors: error.details,
      filePath: error.filePath,
    });
    return {
      code: error.code,
      message: error.message,
      retryable: false,
      ...(diagnostics.length === 0 ? {} : {diagnostics}),
    };
  }
  if (
    isInterModuleKnownError(registryInterModuleContract.methods.resolveVersion, error) &&
    error.code === 'registry-unavailable'
  ) {
    return {code: 'unknown', message: 'The registry is unavailable', retryable: true};
  }
  const methods = [
    integrationsInterModuleContract.methods.resolveSourceRepository,
    integrationsInterModuleContract.methods.listSourceFiles,
    integrationsInterModuleContract.methods.fetchSourceFile,
  ] as const;
  for (const method of methods) {
    if (!isInterModuleKnownError(method, error)) continue;
    if (
      error.code === 'connection-not-found' ||
      error.code === 'connection-inactive' ||
      error.code === 'connection-workspace-mismatch'
    ) {
      return {code: 'connection-unavailable', message: error.message, retryable: false};
    }
    if (error.code === 'provider-failure') {
      return {
        code: providerErrorCode(error.details.reason),
        message: error.message,
        retryable: isProviderReasonRetryable(error.details.reason),
      };
    }
  }
  return {
    code: 'unknown',
    message: error instanceof Error ? error.message : String(error),
    retryable: true,
  };
}

function isProviderReasonRetryable(reason: string): boolean {
  return reason === 'rate-limited' || reason === 'timeout' || reason === 'provider-unavailable';
}

function providerErrorCode(reason: string): DefinitionSyncErrorCode {
  if (reason === 'repository-not-found') return 'provider-repository-not-found';
  if (reason === 'file-not-found') return 'provider-file-not-found';
  if (reason === 'access-denied') return 'provider-access-denied';
  if (reason === 'rate-limited') return 'provider-rate-limited';
  if (reason === 'timeout') return 'provider-timeout';
  if (reason === 'provider-unavailable') return 'provider-unavailable';
  if (reason === 'malformed-provider-response') return 'provider-malformed-response';
  if (reason === 'content-too-large') return 'content-too-large';
  if (reason === 'too-many-files') return 'too-many-files';
  return 'unknown';
}

function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function validationErrorsFrom(details: unknown): ValidationError[] {
  if (!Array.isArray(details)) return [];

  return details.filter(isValidationError);
}

function isValidationError(value: unknown): value is ValidationError {
  if (typeof value !== 'object' || value === null) return false;

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.message === 'string' &&
    (candidate.path === undefined || typeof candidate.path === 'string') &&
    (candidate.reason === undefined || typeof candidate.reason === 'string')
  );
}

function definitionSyncDiagnosticsFor(params: {
  code: DefinitionSyncErrorCode;
  errors: readonly ValidationError[];
  filePath?: string | undefined;
}): DefinitionSyncDiagnostic[] {
  const {code, errors, filePath} = params;
  return limitDefinitionSyncDiagnostics(
    errors.map((error) => ({
      code,
      message:
        error.reason === undefined
          ? error.message
          : `${error.message.replace(TRAILING_SENTENCE_PUNCTUATION_RE, '')}: ${error.reason}`,
      severity: 'error' as const,
      ...(error.path === undefined || error.path.length === 0 ? {} : {path: error.path}),
      ...(filePath === undefined ? {} : {filePath}),
    })),
  );
}
