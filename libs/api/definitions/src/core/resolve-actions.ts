import {Buffer} from 'node:buffer';
import {isDeepStrictEqual} from 'node:util';
import {integrationsInterModuleContract} from '@shipfox/api-integration-core-dto/inter-module';
import {
  type RegistryInterModuleClient,
  registryInterModuleContract,
} from '@shipfox/api-registry-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {boundedMap} from '@shipfox/node-module';
import {
  type ActionBundleFile,
  type ActionManifest,
  actionManifestSchema,
  decodeActionBundle,
  type EncodedActionBundle,
  encodeActionBundle,
  InvalidActionBundleError,
  isCompositeActionManifest,
  parseWorkflowActionRef,
  safeParseActionManifest,
  type WorkflowActionRef,
  type WorkflowDocument,
} from '@shipfox/workflow-document';
import yaml from 'js-yaml';
import {collectActionReferences} from './collect-action-references.js';
import {
  type CompositeUsesResult,
  compositeActionUses,
  resolveCompositeUses,
} from './composite-action-references.js';
import type {ResolvedActions} from './entities/action-snapshot.js';
import type {WorkflowSourceLocation} from './entities/workflow-model.js';
import {ActionResolutionError, type ActionResolutionErrorCode} from './errors.js';
import {
  type DefinitionsSourceControl,
  FILE_FETCH_CONCURRENCY,
  isBinaryFileError,
} from './integrations.js';
import type {ValidationError} from './validate-definition.js';
import {extractActionStepSourceLocations} from './workflow-yaml/index.js';

export const MAX_ACTION_FILES = 100;
export const MAX_ACTION_BYTES = 1024 * 1024;
export const MAX_ACTION_FILE_BYTES = 1_000_000;
export const MAX_ACTIONS_PER_WORKFLOW = 20;
/** How many actions deep a chain of composite actions can go, the last action included. */
export const MAX_ACTION_NESTING_DEPTH = 5;

// GitHub resolves `action.yml` first, so a directory with both uses it.
const ACTION_MANIFEST_FILE_NAMES = ['action.yml', 'action.yaml'] as const;

export interface ActionSourceContext {
  workspaceId: string;
  sourceConnectionId: string;
  sourceExternalRepositoryId: string;
  sourceControl: Pick<DefinitionsSourceControl, 'listFiles' | 'fetchFile'>;
  /** Commit SHA, so every action is read from the same tree as the workflows. */
  ref: string;
}

export interface ResolvedAction {
  /** The key the action is stored under: `uses` as written, or its repository path inside a composite. */
  uses: string;
  /** Set when `uses` names a registry version. Repository actions leave it out. */
  registry?: {package: string; version: string} | undefined;
  /** Repository path of the manifest, or `uses/action.yml` for a registry action, for diagnostics. */
  manifestPath: string;
  manifest: ActionManifest;
  /** Paths relative to the action directory. */
  files: ActionBundleFile[];
  bundle: EncodedActionBundle;
  /** Line ranges of a composite action's steps, by index. Unset on JavaScript actions. */
  stepLocations?: ReadonlyMap<number, WorkflowSourceLocation> | undefined;
}

export interface ResolveWorkflowActionsParams extends ActionSourceContext {
  workflows: readonly {path: string; document: WorkflowDocument}[];
  /** Called with each `uses` path before its directory is read. */
  onProgress?: ((uses: string) => void) | undefined;
  /**
   * Action directories supplied by the caller, keyed by `uses` path. Each one
   * replaces the directory at `ref` completely.
   */
  uploads?: ReadonlyMap<string, readonly ActionBundleFile[]> | undefined;
  /** Resolves registry references. Without it, a registry reference fails. */
  registry?: Pick<RegistryInterModuleClient, 'resolveVersion'> | undefined;
  /** Lets the registry fill and repair its version cache. Defaults to true. */
  persistRegistryVersions?: boolean | undefined;
  /** Accepts composite actions (`steps`). Defaults to `false`. */
  compositeActions?: boolean | undefined;
  /**
   * Accepts registry references inside composite actions. Defaults to `true`;
   * the document parser already checks the workflow's own references.
   */
  registryActions?: boolean | undefined;
}

/** The manifest, digest, and origin that validation and the workflow model read. */
export function summarizeResolvedActions(
  actions: ReadonlyMap<string, ResolvedAction>,
): ResolvedActions {
  return new Map(
    [...actions].map(([uses, action]) => [
      uses,
      {
        manifest: action.manifest,
        digest: action.bundle.digest,
        ...(action.registry === undefined ? {} : {registry: action.registry}),
        ...(isCompositeActionManifest(action.manifest)
          ? {
              composite: {
                manifestPath: action.manifestPath,
                manifestFile: action.manifestPath.slice(action.manifestPath.lastIndexOf('/') + 1),
                stepLocations: action.stepLocations ?? new Map(),
                files: new Map(action.files.map((file) => [file.path, file.content])),
              },
            }
          : {}),
      },
    ]),
  );
}

/**
 * Reads every action the workflows reference, once per key, and the actions
 * their composite actions reference, recursively.
 */
export async function resolveWorkflowActions(
  params: ResolveWorkflowActionsParams,
): Promise<Map<string, ResolvedAction>> {
  const walk: ActionTreeWalk = {params, resolved: new Map(), explored: new Map()};
  for (const workflow of params.workflows) {
    const uses = collectActionReferences(workflow.document);
    if (uses.length > MAX_ACTIONS_PER_WORKFLOW) throw tooManyActions(workflow.path);
  }
  for (const workflow of params.workflows) {
    const reach = {workflowPath: workflow.path, keys: new Set<string>()};
    for (const uses of collectActionReferences(workflow.document)) {
      // Failures of a top-level action point at the workflow file that names it.
      await visitAction(walk, {key: uses, chain: [], referencedFrom: workflow.path, reach});
    }
  }
  return walk.resolved;
}

/** The actions one workflow reaches so far, checked against the limit before each read. */
interface WorkflowReach {
  readonly workflowPath: string;
  readonly keys: Set<string>;
}

function addReached(reach: WorkflowReach, keys: Iterable<string>): void {
  for (const key of keys) reach.keys.add(key);
  if (reach.keys.size > MAX_ACTIONS_PER_WORKFLOW) throw tooManyActions(reach.workflowPath);
}

interface ActionTreeWalk {
  readonly params: ResolveWorkflowActionsParams;
  readonly resolved: Map<string, ResolvedAction>;
  /** Actions whose whole tree is resolved: the keys it reaches and its depth. */
  readonly explored: Map<string, ExploredAction>;
}

interface ExploredAction {
  readonly keys: ReadonlySet<string>;
  /** 1 for an action that uses no other action. */
  readonly height: number;
}

async function visitAction(
  walk: ActionTreeWalk,
  params: {
    key: string;
    chain: readonly ResolvedAction[];
    referencedFrom: string;
    reach: WorkflowReach;
  },
): Promise<ExploredAction> {
  const {key, chain} = params;
  const cycleStart = chain.findIndex((action) => action.uses === key);
  if (cycleStart !== -1) {
    const path = [...chain.slice(cycleStart).map((action) => action.uses), key];
    throw new ActionResolutionError({
      code: 'action-cycle',
      message: `Action ${key} uses itself: ${path.join(' -> ')}`,
      filePath: params.referencedFrom,
    });
  }

  const explored = walk.explored.get(key);
  if (explored !== undefined) {
    if (chain.length + explored.height > MAX_ACTION_NESTING_DEPTH) {
      throw nestingTooDeep({key, chain, referencedFrom: params.referencedFrom});
    }
    addReached(params.reach, explored.keys);
    return explored;
  }
  if (chain.length + 1 > MAX_ACTION_NESTING_DEPTH) {
    throw nestingTooDeep({key, chain, referencedFrom: params.referencedFrom});
  }
  addReached(params.reach, [key]);

  const action = walk.resolved.get(key) ?? (await resolveAction(walk, params));
  walk.resolved.set(key, action);

  const keys = new Set<string>([key]);
  let height = 1;
  for (const {stepIndex, uses} of compositeActionUses(action.manifest)) {
    const inner = innerActionKey(walk, {uses, parentKey: key, parent: action});
    const referencedFrom = diagnosticFileOf(action, params.referencedFrom);
    if (!inner.ok) {
      throw new ActionResolutionError({
        code: 'action-invalid',
        message: `Action ${key} has an invalid step: ${inner.message}`,
        details: [{message: inner.message, path: `steps.${stepIndex}.uses`}],
        filePath: referencedFrom,
      });
    }
    const subtree = await visitAction(walk, {
      key: inner.key,
      chain: [...chain, action],
      referencedFrom,
      reach: params.reach,
    });
    for (const reached of subtree.keys) keys.add(reached);
    height = Math.max(height, subtree.height + 1);
  }

  const result = {keys, height};
  walk.explored.set(key, result);
  return result;
}

function innerActionKey(
  walk: ActionTreeWalk,
  params: {uses: string; parentKey: string; parent: ResolvedAction},
): CompositeUsesResult {
  const result = resolveCompositeUses({
    uses: params.uses,
    parentKey: params.parentKey,
    parentIsRegistry: params.parent.registry !== undefined,
  });
  if (!result.ok || walk.params.registryActions !== false) return result;
  const ref = parseWorkflowActionRef(result.key);
  if (ref.ok && ref.ref.kind === 'registry') {
    return {ok: false, message: 'Registry actions are not available on this instance.'};
  }
  return result;
}

async function resolveAction(
  walk: ActionTreeWalk,
  params: {key: string; referencedFrom: string},
): Promise<ResolvedAction> {
  const {params: options} = walk;
  const {key: uses} = params;
  const compositeActions = options.compositeActions ?? false;
  const ref = parseWorkflowActionRef(uses);
  if (ref.ok && ref.ref.kind === 'registry') {
    options.onProgress?.(uses);
    return await resolveRegistryAction({
      uses,
      ref: ref.ref,
      workflowPath: params.referencedFrom,
      registry: options.registry,
      persist: options.persistRegistryVersions ?? true,
      compositeActions,
    });
  }

  const upload = uploadedDirectory(options.uploads, uses);
  if (upload !== undefined) {
    return await resolveUploadedAction({uses, files: upload, compositeActions});
  }
  options.onProgress?.(uses);
  return await readActionDirectory({...options, uses, compositeActions});
}

/**
 * The uploaded files of an action directory: its own upload, or the part of
 * an uploaded parent directory under it, so a composite's
 * `${{ action.path }}/sub` actions come from the same upload.
 */
function uploadedDirectory(
  uploads: ReadonlyMap<string, readonly ActionBundleFile[]> | undefined,
  uses: string,
): readonly ActionBundleFile[] | undefined {
  if (uploads === undefined) return undefined;
  const exact = uploads.get(uses);
  if (exact !== undefined) return exact;
  let parent: string | undefined;
  for (const path of uploads.keys()) {
    if (!uses.startsWith(`${path}/`)) continue;
    if (parent === undefined || path.length > parent.length) parent = path;
  }
  if (parent === undefined) return undefined;
  const prefix = `${uses.slice(parent.length + 1)}/`;
  return (uploads.get(parent) ?? []).flatMap((file) =>
    file.path.startsWith(prefix) ? [{...file, path: file.path.slice(prefix.length)}] : [],
  );
}

// A registry action has no repository path, so the file that names it carries its failures.
function diagnosticFileOf(action: ResolvedAction, referencedFrom: string): string {
  return action.registry === undefined ? action.manifestPath : referencedFrom;
}

function nestingTooDeep(params: {
  key: string;
  chain: readonly ResolvedAction[];
  referencedFrom: string;
}): ActionResolutionError {
  const path = [...params.chain.map((action) => action.uses), params.key];
  return new ActionResolutionError({
    code: 'action-nesting-too-deep',
    message: `Actions are nested more than ${MAX_ACTION_NESTING_DEPTH} levels deep: ${path.join(' -> ')}`,
    filePath: params.referencedFrom,
  });
}

function tooManyActions(workflowPath: string): ActionResolutionError {
  return new ActionResolutionError({
    code: 'action-too-large',
    message: `Workflow file references more than ${MAX_ACTIONS_PER_WORKFLOW} actions: ${workflowPath}`,
    filePath: workflowPath,
  });
}

export async function readActionDirectory(
  params: ActionSourceContext & {uses: string; compositeActions?: boolean | undefined},
): Promise<ResolvedAction> {
  const {uses} = params;
  const prefix = actionDirectoryPrefix(uses);
  const page = await params.sourceControl.listFiles({
    workspaceId: params.workspaceId,
    connectionId: params.sourceConnectionId,
    externalRepositoryId: params.sourceExternalRepositoryId,
    ref: params.ref,
    prefix,
    limit: MAX_ACTION_FILES,
  });
  if (page.nextCursor) {
    throw new ActionResolutionError({
      code: 'action-too-large',
      message: `Action ${uses} has more than ${MAX_ACTION_FILES} files`,
    });
  }

  const unsupported = page.files.find((entry) => entry.type !== 'file');
  if (unsupported !== undefined) {
    throw new ActionResolutionError({
      code: 'action-unsupported-file',
      message: `Action ${uses} contains a ${unsupported.type}, which is not supported: ${unsupported.path}`,
      filePath: unsupported.path,
    });
  }

  // A directory without a manifest fails before any file is fetched.
  const hasManifest = ACTION_MANIFEST_FILE_NAMES.some((name) =>
    page.files.some((entry) => entry.path === `${prefix}${name}`),
  );
  if (!hasManifest) {
    throw new ActionResolutionError({
      code: 'action-not-found',
      message: `No action.yml or action.yaml found in ${uses}`,
    });
  }

  // Listed sizes reject an oversized action before any file is fetched.
  const sizes = createActionSizeCounter(uses);
  for (const entry of page.files) {
    if (entry.size !== null) sizes.add(entry.path, entry.size);
  }

  const fetchedSizes = createActionSizeCounter(uses);
  const files = await boundedMap(
    page.files,
    FILE_FETCH_CONCURRENCY,
    async (entry) => {
      const content = await fetchActionFile(params, entry.path);
      fetchedSizes.add(entry.path, Buffer.byteLength(content, 'utf8'));
      return {path: entry.path.slice(prefix.length), content};
    },
    {stopOnError: true},
  );

  return await assembleAction({uses, files, compositeActions: params.compositeActions});
}

/** Validates an uploaded action directory with the limits a synced one gets. */
export async function resolveUploadedAction(params: {
  uses: string;
  files: readonly ActionBundleFile[];
  compositeActions?: boolean | undefined;
}): Promise<ResolvedAction> {
  const {uses, files} = params;
  if (files.length > MAX_ACTION_FILES) {
    throw new ActionResolutionError({
      code: 'action-too-large',
      message: `Action ${uses} has more than ${MAX_ACTION_FILES} files`,
    });
  }
  const prefix = actionDirectoryPrefix(uses);
  const sizes = createActionSizeCounter(uses);
  for (const file of files) {
    sizes.add(`${prefix}${file.path}`, Buffer.byteLength(file.content, 'utf8'));
  }
  return await assembleAction({
    uses,
    files: [...files],
    compositeActions: params.compositeActions,
  });
}

async function assembleAction(params: {
  uses: string;
  files: ActionBundleFile[];
  /** Prefixes file paths in diagnostics. Defaults to the repository directory of `uses`. */
  prefix?: string | undefined;
  compositeActions?: boolean | undefined;
}): Promise<ResolvedAction> {
  const {uses, files} = params;
  const prefix = params.prefix ?? actionDirectoryPrefix(uses);
  const manifestFile = ACTION_MANIFEST_FILE_NAMES.map((name) =>
    files.find((file) => file.path === name),
  ).find((file) => file !== undefined);
  if (manifestFile === undefined) {
    throw new ActionResolutionError({
      code: 'action-not-found',
      message: `No action.yml or action.yaml found in ${uses}`,
    });
  }

  const manifestPath = `${prefix}${manifestFile.path}`;
  const manifest = parseActionManifest({
    manifestPath,
    content: manifestFile.content,
    compositeActions: params.compositeActions ?? false,
  });
  for (const field of ['main', 'post'] as const) {
    const entry = manifest[field];
    if (entry === undefined || files.some((file) => file.path === entry)) continue;
    const message = `Action ${field} file ${entry} is not in ${uses}`;
    throw new ActionResolutionError({
      code: 'action-invalid',
      message,
      details: [{message, path: field}],
      filePath: manifestPath,
    });
  }

  let bundle: EncodedActionBundle;
  try {
    bundle = await encodeActionBundle({files});
  } catch (error) {
    if (!(error instanceof InvalidActionBundleError)) throw error;
    throw new ActionResolutionError({
      code: 'action-invalid',
      message: `Action ${uses} cannot be bundled: ${error.message}`,
    });
  }

  return {
    uses,
    manifestPath,
    manifest,
    files,
    bundle,
    ...(isCompositeActionManifest(manifest)
      ? {stepLocations: extractActionStepSourceLocations(manifestFile.content)}
      : {}),
  };
}

async function resolveRegistryAction(params: {
  uses: string;
  ref: Extract<WorkflowActionRef, {kind: 'registry'}>;
  /** The workflow file that names the action, where its failures are reported. */
  workflowPath: string;
  registry: Pick<RegistryInterModuleClient, 'resolveVersion'> | undefined;
  persist: boolean;
  compositeActions: boolean;
}): Promise<ResolvedAction> {
  const {uses, ref, workflowPath} = params;
  const registryPackage = `${ref.namespace}/${ref.name}`;
  const fail = (code: ActionResolutionErrorCode, message: string) =>
    new ActionResolutionError({
      code,
      message,
      details: [{message}],
      filePath: workflowPath,
    });

  if (params.registry === undefined) {
    throw fail('action-invalid', `Registry actions are not available on this instance: ${uses}`);
  }

  let version: Awaited<ReturnType<RegistryInterModuleClient['resolveVersion']>>;
  try {
    version = await params.registry.resolveVersion({
      package: registryPackage,
      version: ref.version,
      kind: 'action',
      ...(params.persist ? {} : {persist: false}),
    });
  } catch (error) {
    throw translateRegistryError({error, uses, fail});
  }

  const {document} = version;
  if (document.kind !== 'action') {
    throw fail('action-invalid', `Registry package ${uses} is not an action`);
  }

  let files: ActionBundleFile[];
  try {
    files = await decodeActionBundle({
      gzip: Buffer.from(version.content, 'base64'),
      digest: document.content.digest,
    });
  } catch (error) {
    if (!(error instanceof InvalidActionBundleError)) throw error;
    throw fail('action-invalid', `Registry action ${uses} has an invalid bundle: ${error.message}`);
  }

  let action: ResolvedAction;
  try {
    action = await assembleAction({
      uses,
      files,
      prefix: `${uses}/`,
      compositeActions: params.compositeActions,
    });
  } catch (error) {
    if (!(error instanceof ActionResolutionError)) throw error;
    // The bundle has no repository path, so the workflow file carries the failure.
    throw new ActionResolutionError({
      code: error.code,
      message: `Registry action ${uses} is invalid: ${error.message}`,
      details: error.details.length === 0 ? [{message: error.message}] : error.details,
      filePath: workflowPath,
    });
  }
  assertManifestMatchesDocument({action, documentManifest: document.manifest, fail});
  return {...action, registry: {package: registryPackage, version: ref.version}};
}

// The signed document is what the registry showed at publish time, so the bundle
// must run the contract that was reviewed.
function assertManifestMatchesDocument(params: {
  action: ResolvedAction;
  documentManifest: Record<string, unknown>;
  fail: (code: ActionResolutionErrorCode, message: string) => ActionResolutionError;
}): void {
  const documented = actionManifestSchema.safeParse(params.documentManifest);
  if (documented.success && isDeepStrictEqual(documented.data, params.action.manifest)) return;
  throw params.fail(
    'action-invalid',
    `Registry action ${params.action.uses} has an action.yml that differs from its signed manifest`,
  );
}

function translateRegistryError(params: {
  error: unknown;
  uses: string;
  fail: (code: ActionResolutionErrorCode, message: string) => ActionResolutionError;
}): unknown {
  const {error, uses, fail} = params;
  if (!isInterModuleKnownError(registryInterModuleContract.methods.resolveVersion, error)) {
    return error;
  }
  switch (error.code) {
    case 'registry-version-not-found':
      return fail('action-not-found', `Registry action ${uses} was not found`);
    case 'registry-signature-invalid':
      return fail(
        'action-invalid',
        `Registry action ${uses} does not verify against the trusted registry keys`,
      );
    case 'registry-schema-unsupported':
      return fail(
        'action-invalid',
        `Registry action ${uses} uses a version document format this instance does not support`,
      );
    case 'registry-disabled':
      return fail('action-invalid', `Registry actions are not available on this instance: ${uses}`);
    default:
      // `registry-unavailable` is retryable, so it keeps its own path.
      return error;
  }
}

function actionDirectoryPrefix(uses: string): string {
  return `${uses.slice('./'.length)}/`;
}

function createActionSizeCounter(uses: string) {
  let total = 0;
  return {
    add(path: string, bytes: number): void {
      if (bytes > MAX_ACTION_FILE_BYTES) {
        throw new ActionResolutionError({
          code: 'action-too-large',
          message: `Action file is larger than ${MAX_ACTION_FILE_BYTES} bytes: ${path}`,
          filePath: path,
        });
      }
      total += bytes;
      if (total > MAX_ACTION_BYTES) {
        throw new ActionResolutionError({
          code: 'action-too-large',
          message: `Action ${uses} is larger than ${MAX_ACTION_BYTES} bytes`,
        });
      }
    },
  };
}

async function fetchActionFile(params: ActionSourceContext, path: string): Promise<string> {
  try {
    const file = await params.sourceControl.fetchFile({
      workspaceId: params.workspaceId,
      connectionId: params.sourceConnectionId,
      externalRepositoryId: params.sourceExternalRepositoryId,
      ref: params.ref,
      path,
    });
    return file.content;
  } catch (error) {
    if (isBinaryFileError(error)) {
      throw new ActionResolutionError({
        code: 'action-unsupported-file',
        message: `Action file is not UTF-8 text: ${path}`,
        filePath: path,
      });
    }
    if (
      isInterModuleKnownError(integrationsInterModuleContract.methods.fetchSourceFile, error) &&
      error.code === 'provider-failure' &&
      error.details.reason === 'content-too-large'
    ) {
      throw new ActionResolutionError({
        code: 'action-too-large',
        message: `Action file is larger than ${MAX_ACTION_FILE_BYTES} bytes: ${path}`,
        filePath: path,
      });
    }
    throw error;
  }
}

function parseActionManifest(params: {
  manifestPath: string;
  content: string;
  compositeActions: boolean;
}): ActionManifest {
  let raw: unknown;
  try {
    raw = yaml.load(params.content);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const message = `Invalid action manifest YAML syntax: ${params.manifestPath}`;
    throw new ActionResolutionError({
      code: 'action-invalid',
      message,
      details: [{message, reason}],
      filePath: params.manifestPath,
    });
  }

  const result = safeParseActionManifest(raw, {compositeActions: params.compositeActions});
  if (result.success) return result.data;

  const details: ValidationError[] = result.error.issues.map((issue) => {
    const path = issue.path.join('.');
    return path.length === 0 ? {message: issue.message} : {message: issue.message, path};
  });
  throw new ActionResolutionError({
    code: 'action-invalid',
    message: `Invalid action manifest at ${params.manifestPath}: ${details[0]?.message ?? 'Invalid manifest'}`,
    details,
    filePath: params.manifestPath,
  });
}
