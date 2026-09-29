import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import type {
  TriggerDto,
  WorkflowModelSnapshot,
  WorkflowSourceSnapshot,
} from '@shipfox/api-definitions-dto';
import {
  createWorkflowModelSnapshot,
  DEFINITION_SYNC_DIAGNOSTICS_MAX_COUNT,
  DEFINITION_SYNC_LAST_ERROR_MESSAGE_MAX_LENGTH,
  DEFINITION_SYNC_WARNING_CODE_MAX_LENGTH,
  DEFINITION_SYNC_WARNING_MESSAGE_MAX_LENGTH,
  DEFINITION_SYNC_WARNING_PATH_MAX_LENGTH,
  MAX_LOCAL_UPLOAD_BYTES,
} from '@shipfox/api-definitions-dto';
import {
  type IntegrationsModuleClient,
  integrationsInterModuleContract,
} from '@shipfox/api-integration-core-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {
  type RegistryInterModuleClient,
  registryInterModuleContract,
} from '@shipfox/api-registry-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {boundedMap} from '@shipfox/node-module';
import type {ActionBundleFile, WorkflowDocument} from '@shipfox/workflow-document';
import {upsertActionSnapshot} from '#db/action-snapshots.js';
import {definitionTriggersFor} from '#db/definition-triggers.js';
import {findOrCreateWorkflowLineage} from '#db/definitions.js';
import {recordDefinitionRefResolution} from '#metrics/index.js';
import {definitionActionsEnabled, definitionRegistryActionsEnabled} from '../config.js';
import {checkActionImports} from './check-action-imports.js';
import {collectActionReferences} from './collect-action-references.js';
import type {ActionSnapshotSource} from './entities/action-snapshot.js';
import type {ValidationDiagnostic} from './entities/validation-diagnostic.js';
import {
  ActionResolutionError,
  DefinitionAtRefError,
  type DefinitionAtRefErrorCode,
  DefinitionParseError,
} from './errors.js';
import {
  FILE_FETCH_CONCURRENCY,
  isBinaryFileError,
  loadIntegrationValidationContext,
} from './integrations.js';
import {needsIntegrationValidationContext} from './needs-integration-validation-context.js';
import type {ParseDefinitionOptions, ParsedDefinition} from './parse-definition.js';
import {parseDefinitionWithDiagnostics} from './parse-definition.js';
import {
  type ResolvedAction,
  resolveWorkflowActions,
  summarizeResolvedActions,
} from './resolve-actions.js';
import {
  DEFAULT_WORKFLOW_PATH,
  isWorkflowFile,
  MAX_WORKFLOW_FILE_BYTES,
  MAX_WORKFLOW_FILES,
} from './sync-definitions.js';
import type {ValidationError} from './validate-definition.js';
import {parseWorkflowYaml} from './workflow-yaml/index.js';

const MAX_LOCAL_WORKFLOW_CONTENT_BYTES = 256 * 1024;

export interface ActionUpload {
  /** The `uses` path the upload replaces, for example `./.shipfox/actions/notify`. */
  path: string;
  /** Every file of the directory, relative to it. */
  files: ActionBundleFile[];
}

export interface ResolveDefinitionAtRefParams {
  projectId: string;
  ref?: string | undefined;
  configPath: string;
  content?: string | undefined;
  expectedCommit?: string | undefined;
  /** Each upload replaces the ref's copy of its action directory completely. */
  actions?: readonly ActionUpload[] | undefined;
  /** Accepts action steps (`uses`). Defaults to `DEFINITION_ACTIONS_ENABLED`. */
  actionsEnabled?: boolean | undefined;
  /**
   * Accepts registry references in `uses`. Defaults to on when
   * `DEFINITION_ACTIONS_ENABLED` is on and `REGISTRY_URL` is set.
   */
  registryActionsEnabled?: boolean | undefined;
  projects: ProjectsModuleClient;
  agent: AgentInterModuleClient;
  integrations: IntegrationsModuleClient;
  /** Resolves registry actions. Without it, a registry reference fails. */
  registry?: Pick<RegistryInterModuleClient, 'resolveVersion'> | undefined;
  signal?: AbortSignal;
}

export interface ValidationWarning {
  code: string;
  message: string;
  path?: string | undefined;
}

export interface ResolvedDefinitionAtRef {
  workflow: {id: string; configPath: string};
  ref: string;
  commit: string;
  model: WorkflowModelSnapshot;
  sourceSnapshot: WorkflowSourceSnapshot;
  triggers: Record<string, TriggerDto>;
  warnings: ValidationWarning[];
}

export interface ListDefinitionsAtRefParams {
  projectId: string;
  ref: string;
  projects: ProjectsModuleClient;
  agent: AgentInterModuleClient;
  integrations: IntegrationsModuleClient;
  project?: DefinitionAtRefProject;
  signal?: AbortSignal;
}

export interface DefinitionAtRefProject {
  workspaceId: string;
  sourceConnectionId: string;
  sourceExternalRepositoryId: string;
}

export interface DefinitionAtRefFile {
  configPath: string;
  name: string | null;
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  triggers: Record<string, TriggerDto>;
}

export interface DefinitionsAtRefListing {
  commit: string;
  files: DefinitionAtRefFile[];
}

interface ResolvedProjectSource {
  workspaceId: string;
  connectionId: string;
  externalRepositoryId: string;
}

/**
 * Resolves a workflow definition at a git ref without persisting it.
 * The ref is pinned to a commit and the content is validated with the sync
 * pipeline. Referenced actions are read at that commit unless uploaded. Only
 * the workflow lineage row and the action snapshots are written, so the dev
 * run can be numbered and its runner can fetch the action code; no definition
 * row and no outbox event are written.
 */
export async function resolveDefinitionAtRef(
  params: ResolveDefinitionAtRefParams,
): Promise<ResolvedDefinitionAtRef> {
  try {
    return await resolveDefinitionAtRefUnsafe(params);
  } catch (error) {
    if (error instanceof DefinitionAtRefError) {
      recordDefinitionRefResolution(error.code);
    }
    throw error;
  }
}

async function resolveDefinitionAtRefUnsafe(
  params: ResolveDefinitionAtRefParams,
): Promise<ResolvedDefinitionAtRef> {
  throwIfAborted(params.signal);
  const uploads = params.actions ?? [];
  assertLocalUploadSize({content: params.content, uploads, configPath: params.configPath});
  const source = await requireProjectSource(
    params.projects,
    params.projectId,
    undefined,
    params.signal,
  );
  const ref = await resolveDefinitionRef({
    integrations: params.integrations,
    source,
    ref: params.ref,
    hasContent: params.content !== undefined,
    signal: params.signal,
  });
  const resolved = await resolveRefToCommit({
    integrations: params.integrations,
    source,
    ref,
    signal: params.signal,
  });
  throwIfAborted(params.signal);
  if (params.expectedCommit !== undefined && resolved.commit !== params.expectedCommit) {
    throw new DefinitionAtRefError(
      'ref-moved',
      `Git ref ${ref} no longer resolves to the expected commit`,
      {ref, expectedCommit: params.expectedCommit},
    );
  }

  const snapshot =
    params.content === undefined
      ? await fetchFileAtCommit({
          integrations: params.integrations,
          source,
          commit: resolved.commit,
          ref,
          configPath: params.configPath,
          signal: params.signal,
        })
      : {path: params.configPath, content: params.content};
  assertFileSize(snapshot.content, snapshot.path, params.content !== undefined);

  const agentValidationCatalog = await callWithSignal(
    params.agent.getValidationCatalogV2,
    {workspaceId: source.workspaceId},
    params.signal,
  );
  throwIfAborted(params.signal);
  const actionsEnabled = params.actionsEnabled ?? definitionActionsEnabled;
  const registryActionsEnabled = params.registryActionsEnabled ?? definitionRegistryActionsEnabled;
  const document = parseWorkflowDocumentAtRef(snapshot.content, {
    agentValidationCatalog,
    actionsEnabled,
    registryActionsEnabled,
  });
  const uploadedPaths = new Set(uploads.map((upload) => upload.path));
  const actions = await resolveDevRunActions({
    integrations: params.integrations,
    source,
    commit: resolved.commit,
    configPath: params.configPath,
    document,
    uploads: new Map(uploads.map((upload) => [upload.path, upload.files])),
    registry: params.registry,
    signal: params.signal,
  });
  const actionManifests = summarizeResolvedActions(actions);

  const parsed = await parseDefinitionAtRef({
    content: snapshot.content,
    document,
    options: {agentValidationCatalog, actionsEnabled, registryActionsEnabled, actionManifests},
    integrations: params.integrations,
    source,
    signal: params.signal,
  });
  throwIfAborted(params.signal);
  // The model references snapshots by digest, so they exist before the run does.
  for (const action of actions.values()) {
    await upsertActionSnapshot({
      workspaceId: source.workspaceId,
      projectId: params.projectId,
      manifest: action.manifest,
      bundle: action.bundle,
      source: snapshotSourceOf(action, uploadedPaths),
    });
  }
  const workflowId = await findOrCreateWorkflowLineage({
    projectId: params.projectId,
    configPath: params.configPath,
  });
  recordDefinitionRefResolution('resolved');

  return {
    workflow: {id: workflowId, configPath: params.configPath},
    ref: resolved.ref,
    commit: resolved.commit,
    model: createWorkflowModelSnapshot(parsed.model),
    sourceSnapshot: {content: snapshot.content, format: 'yaml'},
    triggers: definitionTriggersFor(parsed.model),
    warnings: [...warningsFor(parsed.diagnostics), ...unusedUploadWarnings(document, uploads)],
  };
}

/**
 * Lists the workflow files at a git ref with their validation state. Applies
 * the sync limits (100 files, 1 MB per file). One invalid file does not fail
 * the listing; it is reported as invalid.
 */
export async function listDefinitionsAtRef(
  params: ListDefinitionsAtRefParams,
): Promise<DefinitionsAtRefListing> {
  try {
    return await listDefinitionsAtRefUnsafe(params);
  } catch (error) {
    if (error instanceof DefinitionAtRefError) {
      recordDefinitionRefResolution(error.code);
    }
    throw error;
  }
}

type ListingEntry =
  | {path: string; content: string; definition: ParsedDefinition}
  | {path: string; errors: ValidationError[]};

async function listDefinitionsAtRefUnsafe(
  params: ListDefinitionsAtRefParams,
): Promise<DefinitionsAtRefListing> {
  throwIfAborted(params.signal);
  const source = await requireProjectSource(
    params.projects,
    params.projectId,
    params.project,
    params.signal,
  );
  const resolved = await resolveRefToCommit({
    integrations: params.integrations,
    source,
    ref: params.ref,
    signal: params.signal,
  });
  throwIfAborted(params.signal);
  const commit = resolved.commit;
  const paths = await listWorkflowFilesAtCommit({
    integrations: params.integrations,
    source,
    commit,
    signal: params.signal,
  });

  const fetched = await boundedMap(
    paths,
    FILE_FETCH_CONCURRENCY,
    (path) =>
      fetchListingFile({
        integrations: params.integrations,
        source,
        commit,
        ref: params.ref,
        path,
        signal: params.signal,
      }),
    {stopOnError: true, signal: params.signal},
  );
  throwIfAborted(params.signal);
  const agentValidationCatalog = await callWithSignal(
    params.agent.getValidationCatalogV2,
    {workspaceId: source.workspaceId},
    params.signal,
  );
  throwIfAborted(params.signal);
  let entries = fetched.map((entry) => {
    throwIfAborted(params.signal);
    return parseListingEntry(entry, {agentValidationCatalog});
  });

  const needsIntegrationContext = entries.some(
    (entry) =>
      'definition' in entry && needsIntegrationValidationContext(entry.definition.document),
  );
  if (needsIntegrationContext) {
    const integrationValidationContext = await loadAtRefIntegrationValidationContext({
      integrations: params.integrations,
      source,
      signal: params.signal,
    });
    entries = entries.map((entry) =>
      'definition' in entry && needsIntegrationValidationContext(entry.definition.document)
        ? parseListingEntry(
            {path: entry.path, content: entry.content},
            {agentValidationCatalog, integrationValidationContext},
          )
        : entry,
    );
  }

  throwIfAborted(params.signal);
  recordDefinitionRefResolution('resolved');
  return {commit, files: entries.map((entry) => listingFileFor(entry))};
}

async function requireProjectSource(
  projects: ProjectsModuleClient,
  projectId: string,
  projectOverride: DefinitionAtRefProject | undefined,
  signal: AbortSignal | undefined,
): Promise<ResolvedProjectSource> {
  if (projectOverride !== undefined) return sourceForProject(projectOverride);

  const {project} = await callWithSignal(projects.getProjectById, {projectId}, signal);
  if (project === null) {
    throw new DefinitionAtRefError('project-not-found', `Project not found: ${projectId}`, {
      projectId,
    });
  }
  return sourceForProject(project);
}

function sourceForProject(project: DefinitionAtRefProject): ResolvedProjectSource {
  return {
    workspaceId: project.workspaceId,
    connectionId: project.sourceConnectionId,
    externalRepositoryId: project.sourceExternalRepositoryId,
  };
}

async function resolveDefinitionRef(params: {
  integrations: IntegrationsModuleClient;
  source: ResolvedProjectSource;
  ref: string | undefined;
  hasContent: boolean;
  signal: AbortSignal | undefined;
}): Promise<string> {
  if (params.ref !== undefined) return params.ref;
  if (!params.hasContent) {
    throw new Error('A ref is required when workflow content is not supplied');
  }

  try {
    const resolved = await callWithSignal(
      params.integrations.resolveSourceRepository,
      {
        workspaceId: params.source.workspaceId,
        connectionId: params.source.connectionId,
        externalRepositoryId: params.source.externalRepositoryId,
      },
      params.signal,
    );
    return resolved.repository.defaultBranch;
  } catch (error) {
    throwIfAborted(params.signal);
    if (
      isInterModuleKnownError(
        integrationsInterModuleContract.methods.resolveSourceRepository,
        error,
      )
    ) {
      throw sourceUnavailable(error, 'The source repository is unavailable');
    }
    throw error;
  }
}

async function resolveRefToCommit(params: {
  integrations: IntegrationsModuleClient;
  source: ResolvedProjectSource;
  ref: string;
  signal: AbortSignal | undefined;
}): Promise<{ref: string; commit: string}> {
  try {
    const resolved = await callWithSignal(
      params.integrations.resolveSourceRef,
      {
        workspaceId: params.source.workspaceId,
        connectionId: params.source.connectionId,
        externalRepositoryId: params.source.externalRepositoryId,
        ref: params.ref,
      },
      params.signal,
    );
    return resolved;
  } catch (error) {
    if (isInterModuleKnownError(integrationsInterModuleContract.methods.resolveSourceRef, error)) {
      if (error.code === 'ref-not-found') {
        throw new DefinitionAtRefError('ref-not-found', `Git ref not found: ${params.ref}`, {
          ref: params.ref,
        });
      }
      if (error.code === 'ref-invalid') {
        throw new DefinitionAtRefError(
          'ref-invalid',
          `Git ref is not a resolvable branch or tag name: ${params.ref}`,
          {ref: params.ref},
        );
      }
      throw sourceUnavailable(error, 'The source repository is unavailable');
    }
    throw error;
  }
}

async function listWorkflowFilesAtCommit(params: {
  integrations: IntegrationsModuleClient;
  source: ResolvedProjectSource;
  commit: string;
  signal: AbortSignal | undefined;
}): Promise<string[]> {
  let page: Awaited<ReturnType<IntegrationsModuleClient['listSourceFiles']>>;
  try {
    page = await callWithSignal(
      params.integrations.listSourceFiles,
      {
        workspaceId: params.source.workspaceId,
        connectionId: params.source.connectionId,
        externalRepositoryId: params.source.externalRepositoryId,
        ref: params.commit,
        prefix: DEFAULT_WORKFLOW_PATH,
        limit: MAX_WORKFLOW_FILES,
      },
      params.signal,
    );
  } catch (error) {
    throwIfAborted(params.signal);
    throw sourceUnavailable(error, 'The workflow files at the ref could not be listed');
  }
  if (page.nextCursor) {
    throw new DefinitionAtRefError(
      'too-many-files',
      `More than ${MAX_WORKFLOW_FILES} workflow files were found`,
      {fileCount: Math.max(page.files.length, MAX_WORKFLOW_FILES + 1)},
    );
  }
  return page.files.filter(isWorkflowFile).map((file) => file.path);
}

async function fetchFileAtCommit(params: {
  integrations: IntegrationsModuleClient;
  source: ResolvedProjectSource;
  commit: string;
  ref: string;
  configPath: string;
  signal: AbortSignal | undefined;
}): Promise<{path: string; content: string}> {
  try {
    return await callWithSignal(
      params.integrations.fetchSourceFile,
      {
        workspaceId: params.source.workspaceId,
        connectionId: params.source.connectionId,
        externalRepositoryId: params.source.externalRepositoryId,
        ref: params.commit,
        path: params.configPath,
      },
      params.signal,
    );
  } catch (error) {
    throwIfAborted(params.signal);
    if (isInterModuleKnownError(integrationsInterModuleContract.methods.fetchSourceFile, error)) {
      if (error.code === 'provider-failure' && error.details.reason === 'file-not-found') {
        throw new DefinitionAtRefError(
          'file-not-found',
          `Workflow file not found at ${params.ref}: ${params.configPath}`,
          {ref: params.ref, configPath: params.configPath},
        );
      }
      if (isBinaryFileError(error)) {
        const message = `Workflow file is not UTF-8 text: ${params.configPath}`;
        throw new DefinitionAtRefError('invalid-definition', message, {errors: [{message}]});
      }
      throw sourceUnavailable(error, 'The workflow file at the ref could not be fetched');
    }
    throw error;
  }
}

function assertFileSize(content: string, path: string, isLocalContent = false): void {
  const maxBytes = isLocalContent ? MAX_LOCAL_WORKFLOW_CONTENT_BYTES : MAX_WORKFLOW_FILE_BYTES;
  if (Buffer.byteLength(content, 'utf8') > maxBytes) {
    throw new DefinitionAtRefError(
      'content-too-large',
      `Workflow file is larger than ${maxBytes} bytes: ${path}`,
      {configPath: path},
    );
  }
}

function assertLocalUploadSize(params: {
  content: string | undefined;
  uploads: readonly ActionUpload[];
  configPath: string;
}): void {
  let bytes = params.content === undefined ? 0 : Buffer.byteLength(params.content, 'utf8');
  for (const upload of params.uploads) {
    for (const file of upload.files) bytes += Buffer.byteLength(file.content, 'utf8');
  }
  if (bytes > MAX_LOCAL_UPLOAD_BYTES) {
    throw new DefinitionAtRefError(
      'content-too-large',
      `Local workflow content and action files are larger than ${MAX_LOCAL_UPLOAD_BYTES} bytes`,
      {configPath: params.configPath},
    );
  }
}

/** Parses the document alone, to learn which actions to read before full validation. */
function parseWorkflowDocumentAtRef(
  content: string,
  options: ParseDefinitionOptions & {actionsEnabled: boolean; registryActionsEnabled: boolean},
): WorkflowDocument {
  try {
    return parseWorkflowYaml(content, {
      actions: options.actionsEnabled,
      registryActions: options.registryActionsEnabled,
    });
  } catch (error) {
    // Full validation fails the same way and reports the failure with its details.
    parseWorkflowDefinition(content, options);
    const message = error instanceof Error ? error.message : String(error);
    throw new DefinitionAtRefError(
      'invalid-definition',
      `Invalid workflow definition: ${message}`,
      {errors: boundedValidationErrors([{message}])},
    );
  }
}

async function resolveDevRunActions(params: {
  integrations: IntegrationsModuleClient;
  source: ResolvedProjectSource;
  commit: string;
  configPath: string;
  document: WorkflowDocument;
  uploads: ReadonlyMap<string, readonly ActionBundleFile[]>;
  registry: Pick<RegistryInterModuleClient, 'resolveVersion'> | undefined;
  signal: AbortSignal | undefined;
}): Promise<Map<string, ResolvedAction>> {
  if (collectActionReferences(params.document).length === 0) return new Map();

  let actions: Map<string, ResolvedAction>;
  try {
    actions = await resolveWorkflowActions({
      workspaceId: params.source.workspaceId,
      sourceConnectionId: params.source.connectionId,
      sourceExternalRepositoryId: params.source.externalRepositoryId,
      ref: params.commit,
      sourceControl: {
        listFiles: (input) =>
          callWithSignal(params.integrations.listSourceFiles, input, params.signal),
        fetchFile: (input) =>
          callWithSignal(params.integrations.fetchSourceFile, input, params.signal),
      },
      workflows: [{path: params.configPath, document: params.document}],
      uploads: params.uploads,
      registry: params.registry,
    });
  } catch (error) {
    throwIfAborted(params.signal);
    if (error instanceof ActionResolutionError) throw invalidAction(error);
    if (
      isInterModuleKnownError(integrationsInterModuleContract.methods.listSourceFiles, error) ||
      isInterModuleKnownError(integrationsInterModuleContract.methods.fetchSourceFile, error)
    ) {
      throw sourceUnavailable(error, 'The action files at the ref could not be read');
    }
    if (isInterModuleKnownError(registryInterModuleContract.methods.resolveVersion, error)) {
      // A dev run has no retry, so the caller reads the reason and tries again.
      const message = 'A registry action could not be resolved because the registry is unavailable';
      throw new DefinitionAtRefError(
        'invalid-definition',
        `Invalid workflow definition: ${message}`,
        {
          errors: boundedValidationErrors([{message}]),
        },
      );
    }
    throw error;
  }

  // A dev run fails on an import the runner could not load, unlike sync, which
  // only warns, so a forgotten upload is caught before any code runs.
  const errors: ValidationError[] = [];
  for (const action of actions.values()) {
    // Registry actions are bundled, and the runner loads them strictly.
    if (action.registry !== undefined) continue;
    for (const issue of await checkActionImports({files: action.files})) {
      errors.push({message: `Action ${action.uses}: ${issue.message}`});
    }
  }
  const [first] = errors;
  if (first !== undefined) {
    throw new DefinitionAtRefError(
      'invalid-definition',
      `Invalid workflow definition: ${first.message}`,
      {errors: boundedValidationErrors(errors)},
    );
  }
  return actions;
}

function snapshotSourceOf(
  action: ResolvedAction,
  uploadedPaths: ReadonlySet<string>,
): ActionSnapshotSource {
  if (action.registry !== undefined) return 'registry';
  return uploadedPaths.has(action.uses) ? 'dev_local' : 'vcs';
}

function invalidAction(error: ActionResolutionError): DefinitionAtRefError {
  const errors =
    error.details.length === 0
      ? [{message: error.message}]
      : error.details.map((detail) =>
          error.filePath === undefined
            ? detail
            : {...detail, message: `${error.filePath}: ${detail.message}`},
        );
  return new DefinitionAtRefError(
    'invalid-definition',
    `Invalid workflow definition: ${error.message}`,
    {errors: boundedValidationErrors(errors)},
  );
}

async function parseDefinitionAtRef(params: {
  content: string;
  document: WorkflowDocument;
  options: ParseDefinitionOptions;
  integrations: IntegrationsModuleClient;
  source: ResolvedProjectSource;
  signal: AbortSignal | undefined;
}): Promise<ParsedDefinition> {
  if (!needsIntegrationValidationContext(params.document, params.options.actionManifests)) {
    return parseWorkflowDefinition(params.content, params.options);
  }

  const integrationValidationContext = await loadAtRefIntegrationValidationContext({
    integrations: params.integrations,
    source: params.source,
    signal: params.signal,
  });
  return parseWorkflowDefinition(params.content, {
    ...params.options,
    integrationValidationContext,
  });
}

function parseWorkflowDefinition(
  content: string,
  options: Parameters<typeof parseDefinitionWithDiagnostics>[1],
): ParsedDefinition {
  try {
    return parseDefinitionWithDiagnostics(content, options);
  } catch (error) {
    if (error instanceof DefinitionParseError) {
      throw new DefinitionAtRefError(
        'invalid-definition',
        `Invalid workflow definition: ${error.message}`,
        {errors: boundedValidationErrors((error.details ?? []) as ValidationError[])},
      );
    }
    throw error;
  }
}

async function fetchListingFile(params: {
  integrations: IntegrationsModuleClient;
  source: ResolvedProjectSource;
  commit: string;
  ref: string;
  path: string;
  signal: AbortSignal | undefined;
}): Promise<{path: string; content: string} | {path: string; errors: ValidationError[]}> {
  try {
    const snapshot = await fetchFileAtCommit({
      integrations: params.integrations,
      source: params.source,
      commit: params.commit,
      ref: params.ref,
      configPath: params.path,
      signal: params.signal,
    });
    assertFileSize(snapshot.content, snapshot.path);
    return {path: snapshot.path, content: snapshot.content};
  } catch (error) {
    if (error instanceof DefinitionAtRefError && isPerFileListingError(error.code)) {
      return {
        path: params.path,
        errors: boundedValidationErrors([{message: error.message}]),
      };
    }
    throw error;
  }
}

function parseListingEntry(
  entry: {path: string; content: string} | {path: string; errors: ValidationError[]},
  options: Parameters<typeof parseDefinitionWithDiagnostics>[1],
): ListingEntry {
  if ('errors' in entry) return entry;
  try {
    const definition = parseDefinitionWithDiagnostics(entry.content, options);
    return {path: entry.path, content: entry.content, definition};
  } catch (error) {
    if (error instanceof DefinitionParseError) {
      return {
        path: entry.path,
        errors: boundedValidationErrors((error.details ?? []) as ValidationError[]),
      };
    }
    throw error;
  }
}

function listingFileFor(entry: ListingEntry): DefinitionAtRefFile {
  if ('definition' in entry) {
    return {
      configPath: entry.path,
      name: entry.definition.document.name,
      valid: true,
      errors: [],
      warnings: listingWarningsFor(entry.definition.diagnostics),
      triggers: definitionTriggersFor(entry.definition.model),
    };
  }
  return {
    configPath: entry.path,
    name: null,
    valid: false,
    errors: entry.errors,
    warnings: [],
    triggers: {},
  };
}

function warningsFor(diagnostics: readonly ValidationDiagnostic[]): ValidationWarning[] {
  return diagnostics
    .filter((diagnostic) => diagnostic.severity === 'warning')
    .map((diagnostic) => ({
      code: diagnostic.code.slice(0, DEFINITION_SYNC_WARNING_CODE_MAX_LENGTH),
      message: diagnostic.message.slice(0, DEFINITION_SYNC_WARNING_MESSAGE_MAX_LENGTH),
      ...(diagnostic.path === undefined
        ? {}
        : {path: diagnostic.path.slice(0, DEFINITION_SYNC_WARNING_PATH_MAX_LENGTH)}),
    }));
}

function unusedUploadWarnings(
  document: WorkflowDocument,
  uploads: readonly ActionUpload[],
): ValidationWarning[] {
  const used = new Set(collectActionReferences(document));
  return uploads
    .filter((upload) => !used.has(upload.path))
    .map((upload) => ({
      code: 'action-upload-unused',
      message: `Uploaded action ${upload.path} is not used by any step`.slice(
        0,
        DEFINITION_SYNC_WARNING_MESSAGE_MAX_LENGTH,
      ),
    }));
}

function listingWarningsFor(diagnostics: readonly ValidationDiagnostic[]): ValidationWarning[] {
  return warningsFor(diagnostics).slice(0, DEFINITION_SYNC_DIAGNOSTICS_MAX_COUNT);
}

function boundedValidationErrors(errors: readonly ValidationError[]): ValidationError[] {
  return errors.slice(0, DEFINITION_SYNC_DIAGNOSTICS_MAX_COUNT).map((error) => ({
    message: error.message.slice(0, DEFINITION_SYNC_WARNING_MESSAGE_MAX_LENGTH),
    ...(error.path === undefined
      ? {}
      : {path: error.path.slice(0, DEFINITION_SYNC_WARNING_PATH_MAX_LENGTH)}),
    ...(error.reason === undefined
      ? {}
      : {reason: error.reason.slice(0, DEFINITION_SYNC_LAST_ERROR_MESSAGE_MAX_LENGTH)}),
  }));
}

async function loadAtRefIntegrationValidationContext(params: {
  integrations: IntegrationsModuleClient;
  source: ResolvedProjectSource;
  signal: AbortSignal | undefined;
}) {
  try {
    return await loadIntegrationValidationContext(
      params.integrations,
      params.source.workspaceId,
      params.source.connectionId,
      params.signal,
    );
  } catch (error) {
    throwIfAborted(params.signal);
    throw sourceUnavailable(error, 'Integration validation context is unavailable');
  }
}

function isPerFileListingError(code: DefinitionAtRefErrorCode): boolean {
  return (
    code === 'file-not-found' ||
    code === 'content-too-large' ||
    code === 'invalid-definition' ||
    code === 'source-unavailable'
  );
}

function callWithSignal<Input, Output>(
  method: (input: Input, options?: {signal?: AbortSignal}) => Promise<Output>,
  input: Input,
  signal: AbortSignal | undefined,
): Promise<Output> {
  return signal === undefined ? method(input) : method(input, {signal});
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new Error('Operation aborted');
}

function sourceUnavailable(error: unknown, message: string): DefinitionAtRefError {
  return new DefinitionAtRefError(
    'source-unavailable',
    `${message}: ${error instanceof Error ? error.message : String(error)}`,
    sourceFailureDetails(error),
  );
}

function sourceFailureDetails(error: unknown): Record<string, unknown> {
  const methods = [
    integrationsInterModuleContract.methods.resolveSourceRepository,
    integrationsInterModuleContract.methods.resolveSourceRef,
    integrationsInterModuleContract.methods.listSourceFiles,
    integrationsInterModuleContract.methods.fetchSourceFile,
    integrationsInterModuleContract.methods.getAgentToolsContext,
  ] as const;

  for (const method of methods) {
    if (!isInterModuleKnownError(method, error)) continue;
    if (
      error.code === 'connection-not-found' ||
      error.code === 'connection-inactive' ||
      error.code === 'connection-workspace-mismatch'
    ) {
      return {sourceCode: error.code};
    }
    if (error.code === 'provider-failure') {
      return {
        sourceCode: error.code,
        sourceReason: error.details.reason,
        ...(error.details.retryAfterSeconds === undefined
          ? {}
          : {retryAfterSeconds: error.details.retryAfterSeconds}),
      };
    }
  }

  return {};
}
