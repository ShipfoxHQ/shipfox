/** What an action step's `uses` names: a repository directory or a registry version. */
export type WorkflowActionRef =
  | {kind: 'local'; path: string}
  | {kind: 'registry'; namespace: string; name: string; version: string};

export type WorkflowActionRefResult =
  | {ok: true; ref: WorkflowActionRef}
  | {
      ok: false;
      message: string;
      /**
       * True when the message is about the registry reference grammar. Without
       * registry actions, those forms are reported as unsupported instead.
       */
      registry: boolean;
    };

// A copy of the API resource slug grammar: this package is browser-safe and
// cannot depend on an API package.
export const WORKFLOW_REGISTRY_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const WORKFLOW_REGISTRY_SLUG_MIN_LENGTH = 2;
export const WORKFLOW_REGISTRY_SLUG_MAX_LENGTH = 40;

const exactVersionPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const urlPattern = /^[A-Za-z][A-Za-z0-9+.-]*:/;

export const REMOTE_ACTIONS_UNSUPPORTED_MESSAGE =
  'Remote actions are not supported yet. Use a repository path that starts with `./`.';

export function isWorkflowRegistrySlug(value: string): boolean {
  return (
    value.length >= WORKFLOW_REGISTRY_SLUG_MIN_LENGTH &&
    value.length <= WORKFLOW_REGISTRY_SLUG_MAX_LENGTH &&
    WORKFLOW_REGISTRY_SLUG_PATTERN.test(value)
  );
}

/** Whether `value` is a registry package name, `namespace/name`. */
export function isWorkflowRegistryPackageName(value: string): boolean {
  const segments = value.split('/');
  return segments.length === 2 && segments.every(isWorkflowRegistrySlug);
}

/**
 * Classifies a literal `uses` value. Repository path forms keep their own
 * messages, so a mistyped `./` path never reads as a registry problem.
 */
export function parseWorkflowActionRef(uses: string): WorkflowActionRefResult {
  return localActionRef(uses) ?? registryActionRef(uses);
}

function localActionRef(uses: string): WorkflowActionRefResult | undefined {
  if (uses.startsWith('./')) {
    if (!isNormalizedRelativePath(uses.slice(2))) {
      return pathIssue(
        'Action paths must be normalized: no empty, `.`, or `..` segments, no backslashes, and no trailing `/`.',
      );
    }
    return {ok: true, ref: {kind: 'local', path: uses}};
  }
  if (uses === '.' || uses === '..' || uses.startsWith('../')) {
    return pathIssue('Action paths must stay inside the repository and start with `./`.');
  }
  if (uses.startsWith('/')) return pathIssue('Action paths must be relative and start with `./`.');
  if (urlPattern.test(uses)) {
    return pathIssue('Action URLs are not supported. Use a repository path that starts with `./`.');
  }
  return undefined;
}

function registryActionRef(uses: string): WorkflowActionRefResult {
  const versionStart = uses.indexOf('@');
  const packagePath = versionStart === -1 ? uses : uses.slice(0, versionStart);
  const version = versionStart === -1 ? undefined : uses.slice(versionStart + 1);
  const segments = packagePath.split('/');
  const [namespace = '', name = ''] = segments;

  if (namespace.includes('.') || namespace.includes(':')) {
    return registryIssue('Other registries are not supported yet.');
  }
  if (segments.length > 2) {
    return registryIssue('Remote actions come from the registry, not from Git.');
  }
  if (segments.length < 2 || namespace === '' || name === '') {
    return registryIssue(
      'Use a repository path that starts with `./`, or a registry reference such as `shipfox/slack-thread-digest@1.4.2`.',
    );
  }
  if (version === undefined || !exactVersionPattern.test(version)) {
    return registryIssue(`Pin an exact version, such as \`${packagePath}@1.4.2\`.`);
  }
  if (!isWorkflowRegistrySlug(namespace) || !isWorkflowRegistrySlug(name)) {
    return registryIssue(
      'Registry namespaces and names use 2 to 40 lowercase letters, digits, and single hyphens.',
    );
  }
  return {ok: true, ref: {kind: 'registry', namespace, name, version}};
}

export function isNormalizedRelativePath(path: string): boolean {
  if (path.length === 0 || path.includes('\\') || path.includes('\u0000')) return false;
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function pathIssue(message: string): WorkflowActionRefResult {
  return {ok: false, message, registry: false};
}

function registryIssue(message: string): WorkflowActionRefResult {
  return {ok: false, message, registry: true};
}
