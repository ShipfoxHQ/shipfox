import {integrationsInterModuleContract} from '@shipfox/api-integration-core-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {boundedMap} from '@shipfox/node-module';
import {
  type ActionBundleFile,
  type ActionManifest,
  actionManifestSchema,
  type EncodedActionBundle,
  encodeActionBundle,
  InvalidActionBundleError,
  type WorkflowDocument,
} from '@shipfox/workflow-document';
import yaml from 'js-yaml';
import {collectActionReferences} from './collect-action-references.js';
import {ActionResolutionError} from './errors.js';
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
  /** Repository path of the manifest, for diagnostics. */
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
}

/** Reads every action the workflows reference, once per `uses` path. */
export async function resolveWorkflowActions(
  params: ResolveWorkflowActionsParams,
): Promise<Map<string, ResolvedAction>> {
  const references = new Set<string>();
  for (const workflow of params.workflows) {
    const uses = collectActionReferences(workflow.document);
    if (uses.length > MAX_ACTIONS_PER_WORKFLOW) {
      throw new ActionResolutionError({
        code: 'action-too-large',
        message: `Workflow file references more than ${MAX_ACTIONS_PER_WORKFLOW} actions: ${workflow.path}`,
        filePath: workflow.path,
      });
    }
    for (const path of uses) references.add(path);
  }

  const resolved = new Map<string, ResolvedAction>();
  // One directory at a time, so file fetches stay within FILE_FETCH_CONCURRENCY.
  for (const uses of references) {
    params.onProgress?.(uses);
    resolved.set(uses, await readActionDirectory({...params, uses}));
  }
  return resolved;
}

export async function readActionDirectory(
  params: ActionSourceContext & {uses: string},
): Promise<ResolvedAction> {
  const {uses} = params;
  const prefix = `${uses.slice('./'.length)}/`;
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

  const manifestPath = ACTION_MANIFEST_FILE_NAMES.map((name) => `${prefix}${name}`).find((path) =>
    page.files.some((entry) => entry.path === path),
  );
  if (manifestPath === undefined) {
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

  const manifestContent = files.find((file) => `${prefix}${file.path}` === manifestPath)?.content;
  const manifest = parseActionManifest({manifestPath, content: manifestContent ?? ''});
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
