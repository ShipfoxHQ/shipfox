import {realpathSync} from 'node:fs';
import {isBuiltin, type ResolveHookContext, type ResolveHookSync} from 'node:module';
import {join, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const SDK_PACKAGE = '@shipfox/actions';
type NextResolve = Parameters<ResolveHookSync>[2];

const URL_SCHEME_RE = /^[a-z][a-z\d+.-]*:/i;

export const PACKAGE_NOT_FOUND_HINT =
  'Install it in an earlier step; actions resolve packages from the step working directory.';

export interface ActionResolveHookParams {
  /** The extracted bundle directory, already passed through `realpath`. */
  bundleDir: string;
  /** The step working directory, where the job installed the action's packages. */
  workspaceDir: string;
  /** A module URL inside this package, used to resolve the SDK by self-reference. */
  sdkUrl: string;
}

/**
 * Resolves by importer, not only by specifier. The first hop out of the bundle is re-parented to
 * the step working directory; every later hop keeps Node's resolution, so a package finds its own
 * dependencies where an isolated layout (pnpm) puts them.
 */
export function createActionResolveHook(params: ActionResolveHookParams): ResolveHookSync {
  const bundlePrefix = params.bundleDir.endsWith(sep)
    ? params.bundleDir
    : `${params.bundleDir}${sep}`;
  const workspacePackageUrl = pathToFileURL(join(params.workspaceDir, 'package.json')).href;
  const isInsideBundle = (url: string | undefined): boolean =>
    url?.startsWith('file:') === true && realPath(fileURLToPath(url)).startsWith(bundlePrefix);

  const resolveFromWorkspace = (
    specifier: string,
    context: ResolveHookContext,
    nextResolve: NextResolve,
  ) => {
    // Node merges the context passed to nextResolve into this one, so read the importer first.
    const importer = importerPath(context);
    try {
      return nextResolve(specifier, {...context, parentURL: workspacePackageUrl});
    } catch (error) {
      if (!isPackageNotFound(error)) throw error;
      throw moduleError({
        code: 'ERR_MODULE_NOT_FOUND',
        message: `Cannot find package '${specifier}' imported from ${importer}, looked up from ${params.workspaceDir}. ${PACKAGE_NOT_FOUND_HINT}`,
        cause: error,
      });
    }
  };

  const resolveInsideBundle = (
    specifier: string,
    context: ResolveHookContext,
    nextResolve: NextResolve,
  ) => {
    const resolved = nextResolve(specifier, context);
    if (resolved.url.startsWith('file:') && !isInsideBundle(resolved.url)) {
      throw moduleError({
        code: 'ERR_SHIPFOX_ACTION_IMPORT_OUTSIDE_ACTION',
        message: `'${specifier}' imported from ${importerPath(context)} resolves outside the action directory. Only files inside the action directory are part of the action.`,
      });
    }
    return resolved;
  };

  return (specifier, context, nextResolve) => {
    // One SDK copy for the bootstrap, the action, and any workspace helper, so they share types
    // like ToolCallError.
    if (specifier === SDK_PACKAGE || specifier.startsWith(`${SDK_PACKAGE}/`)) {
      return nextResolve(specifier, {...context, parentURL: params.sdkUrl});
    }
    if (!isInsideBundle(context.parentURL) || isBuiltin(specifier)) {
      return nextResolve(specifier, context);
    }
    return isBareSpecifier(specifier)
      ? resolveFromWorkspace(specifier, context, nextResolve)
      : resolveInsideBundle(specifier, context, nextResolve);
  };
}

function importerPath(context: ResolveHookContext): string {
  return context.parentURL ? fileURLToPath(context.parentURL) : '<entry>';
}

function isBareSpecifier(specifier: string): boolean {
  return (
    !specifier.startsWith('.') &&
    !specifier.startsWith('/') &&
    !specifier.startsWith('#') &&
    !URL_SCHEME_RE.test(specifier)
  );
}

// Node uses ERR_MODULE_NOT_FOUND both for a missing package and for a missing file inside an
// installed one. Only a missing package gets the install hint; the other keeps Node's error.
function isPackageNotFound(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as {code?: unknown}).code === 'ERR_MODULE_NOT_FOUND' &&
    error.message.startsWith('Cannot find package')
  );
}

function moduleError(params: {code: string; message: string; cause?: unknown}): Error {
  const error = new Error(
    params.message,
    params.cause === undefined ? undefined : {cause: params.cause},
  );
  return Object.assign(error, {code: params.code});
}

function realPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}
