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
  parseWorkflowActionRef,
  type WorkflowActionRef,
  type WorkflowDocument,
} from '@shipfox/workflow-document';
import yaml from 'js-yaml';
import {collectActionReferences} from './collect-action-references.js';
import type {ResolvedActions} from './entities/action-snapshot.js';
import {ActionResolutionError, type ActionResolutionErrorCode} from './errors.js';
import {
  type DefinitionsSourceControl,
  FILE_FETCH_CONCURRENCY,
  isBinaryFileError,
} from './integrations.js';
import type {ValidationError} from './validate-definition.js';

export const MAX_ACTION_FILES = 100;
export const MAX_ACTION_BYTES = 1024 * 1024;
export const MAX_ACTION_FILE_BYTES = 1_000_000;
export const MAX_ACTIONS_PER_WORKFLOW = 20;

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
  uses: string;
  /** Set when `uses` names a registry version. Repository actions leave it out. */
  registry?: {package: string; version: string} | undefined;
  /** Repository path of the manifest, or `uses/action.yml` for a registry action, for diagnostics. */
  manifestPath: string;
  manifest: ActionManifest;
  /** Paths relative to the action directory. */
  files: ActionBundleFile[];
  bundle: EncodedActionBundle;
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
      },
    ]),
  );
}

/** Reads every action the workflows reference, once per `uses` path. */
export async function resolveWorkflowActions(
  params: ResolveWorkflowActionsParams,
): Promise<Map<string, ResolvedAction>> {
  // The first workflow file that names each action, so its failures point at a workflow.
  const references = new Map<string, string>();
  for (const workflow of params.workflows) {
    const uses = collectActionReferences(workflow.document);
    if (uses.length > MAX_ACTIONS_PER_WORKFLOW) {
      throw new ActionResolutionError({
        code: 'action-too-large',
        message: `Workflow file references more than ${MAX_ACTIONS_PER_WORKFLOW} actions: ${workflow.path}`,
        filePath: workflow.path,
      });
    }
    for (const path of uses) {
      if (!references.has(path)) references.set(path, workflow.path);
    }
  }

  const resolved = new Map<string, ResolvedAction>();
  // One action at a time, so file fetches stay within FILE_FETCH_CONCURRENCY.
  for (const [uses, workflowPath] of references) {
    const ref = parseWorkflowActionRef(uses);
    if (ref.ok && ref.ref.kind === 'registry') {
      params.onProgress?.(uses);
      resolved.set(
        uses,
        await resolveRegistryAction({
          uses,
          ref: ref.ref,
          workflowPath,
          registry: params.registry,
        }),
      );
      continue;
    }

    const upload = params.uploads?.get(uses);
    if (upload !== undefined) {
      resolved.set(uses, await resolveUploadedAction({uses, files: upload}));
      continue;
    }
    params.onProgress?.(uses);
    resolved.set(uses, await readActionDirectory({...params, uses}));
  }
  return resolved;
}

export async function readActionDirectory(
  params: ActionSourceContext & {uses: string},
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

  return await assembleAction({uses, files});
}

/** Validates an uploaded action directory with the limits a synced one gets. */
export async function resolveUploadedAction(params: {
  uses: string;
  files: readonly ActionBundleFile[];
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
  return await assembleAction({uses, files: [...files]});
}

async function assembleAction(params: {
  uses: string;
  files: ActionBundleFile[];
  /** Prefixes file paths in diagnostics. Defaults to the repository directory of `uses`. */
  prefix?: string | undefined;
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
  const manifest = parseActionManifest({manifestPath, content: manifestFile.content});
  if (!files.some((file) => file.path === manifest.main)) {
    const message = `Action main file ${manifest.main} is not in ${uses}`;
    throw new ActionResolutionError({
      code: 'action-invalid',
      message,
      details: [{message, path: 'main'}],
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

  return {uses, manifestPath, manifest, files, bundle};
}

async function resolveRegistryAction(params: {
  uses: string;
  ref: Extract<WorkflowActionRef, {kind: 'registry'}>;
  /** The workflow file that names the action, where its failures are reported. */
  workflowPath: string;
  registry: Pick<RegistryInterModuleClient, 'resolveVersion'> | undefined;
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
    action = await assembleAction({uses, files, prefix: `${uses}/`});
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

function parseActionManifest(params: {manifestPath: string; content: string}): ActionManifest {
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

  const result = actionManifestSchema.safeParse(raw);
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
