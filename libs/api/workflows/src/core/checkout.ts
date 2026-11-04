import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {checkoutTargetValidationIssues} from '@shipfox/workflow-document';
import {z} from 'zod';
import {
  type CheckoutRenewalSubject,
  normalizeRepositoryUrl,
} from '#core/entities/checkout-renewal-subject.js';
import type {Step} from '#core/entities/step.js';
import type {
  WorkflowRunOriginState,
  WorkflowRunTriggerReference,
} from '#core/entities/workflow-run.js';
import {loadProjectCheckoutDefaults, type ProjectCheckoutDefaults} from './default-checkout.js';
import {
  CheckoutConfigInvalidError,
  type CheckoutFailureTarget,
  CheckoutIntentUnresolvedError,
} from './errors.js';
import {isManagedProject} from './managed-source.js';

const checkoutConfigSchema = z
  .object({
    project: z.string().uuid().optional(),
    connection: z.string().min(1).optional(),
    repository: z.string().min(1).optional(),
    ref: z.string().min(1).optional(),
    fetch_depth: z.number().int().nonnegative().optional(),
    permissions: z.object({contents: z.enum(['read', 'write'])}).optional(),
    persist_credentials: z.boolean().optional(),
  })
  .superRefine((checkout, context) => {
    for (const validationIssue of checkoutTargetValidationIssues(checkout)) {
      let message = 'Checkout connection requires a repository.';
      if (validationIssue.kind === 'project-with-connection') {
        message = 'Checkout project cannot be combined with a connection.';
      } else if (validationIssue.kind === 'project-with-repository') {
        message = 'Checkout project cannot be combined with a repository.';
      }
      context.addIssue({
        code: 'custom',
        path: [validationIssue.path],
        message,
      });
    }
  });

type CheckoutConfig = z.infer<typeof checkoutConfigSchema>;

export interface CheckoutPolicy {
  persistCredentials: boolean;
  permissionsContents: 'read' | 'write';
}

export function getCheckoutPolicy(stepConfig: unknown): CheckoutPolicy | null {
  if (typeof stepConfig !== 'object' || stepConfig === null || Array.isArray(stepConfig))
    return null;
  const checkout = (stepConfig as {checkout?: unknown}).checkout;
  const result = checkoutConfigSchema.safeParse(checkout);
  if (!result.success) return null;
  return {
    persistCredentials: result.data.persist_credentials ?? true,
    permissionsContents: result.data.permissions?.contents ?? 'read',
  };
}

export async function createStepCheckoutSpec({
  step,
  workspaceId,
  projectId,
  triggerReference,
  run,
  integrations,
  projects,
  failure = {},
}: {
  step: Step;
  workspaceId: string;
  projectId: string;
  triggerReference?: WorkflowRunTriggerReference | null | undefined;
  /** The run's origin state; a dev run checks out its dev commit by default. */
  run: WorkflowRunOriginState;
  integrations: IntegrationsModuleClient;
  projects: ProjectsModuleClient;
  /** Filled in as the target resolves, so a caller can name it when the checkout fails. */
  failure?: CheckoutFailureTarget;
}): Promise<{
  spec: {
    repositoryUrl: string;
    ref: string;
    credentials?: {
      username: string;
      token: string;
      expiresAt: Date;
      generation?: string | undefined;
      renewal?: {mode: 'refresh-at'; refreshAt: Date} | {mode: 'on-rejection'} | undefined;
    };
    gitAuthor?: {name: string; email: string};
  };
  fetchDepth: number;
  persistCredentials: boolean;
  renewalSubject?: Omit<CheckoutRenewalSubject, 'stepId' | 'attempt'>;
}> {
  const checkout = parseCheckoutConfig(step);
  failure.connection = checkout.connection;
  failure.project = checkout.project;
  failure.repository = checkout.repository;
  const {project: defaultProject} = await projects.getProjectById({projectId});
  if (defaultProject === null || defaultProject === undefined) {
    throw new CheckoutIntentUnresolvedError({kind: 'project', value: projectId});
  }

  // A managed project has no source connection or owner of its own to default to.
  const managedDefaults = isManagedProject(defaultProject)
    ? ((await loadProjectCheckoutDefaults({project: defaultProject, projects, integrations})) ??
      noDefaults)
    : undefined;
  if (managedDefaults !== undefined)
    assertManagedCheckoutTarget(checkout, managedDefaults, step.id);
  const target = await checkoutTarget({
    checkout,
    defaultProjectId: projectId,
    defaultConnectionId: defaultProject.sourceConnectionId,
    managedDefaults,
    integrations,
    workspaceId,
    stepId: step.id,
  });
  const resolvedTarget = await resolveCheckoutTargetSelection({
    target,
    workspaceId,
    defaultProject,
    projects,
    stepId: step.id,
  });
  if (resolvedTarget === undefined) {
    throw new CheckoutIntentUnresolvedError({
      kind: 'project',
      value: 'project' in target ? target.project : projectId,
    });
  }
  failure.connectionId = resolvedTarget.connectionId;
  failure.repository =
    resolvedRepositoryName(resolvedTarget, defaultProject) ??
    defaultCheckoutName(target) ??
    failure.repository;
  const ref = resolveCheckoutRef({checkout, triggerReference, run, resolvedTarget, projectId});
  const permissions = checkout.permissions ?? {contents: 'read'};
  const response = await integrations.createCheckoutSpec({
    workspaceId,
    connectionId: resolvedTarget.connectionId,
    projectId,
    target: resolvedTarget.target,
    ...(ref === undefined ? {} : {ref}),
    permissions,
  });

  return checkoutResult(checkout, response, {
    connectionId: resolvedTarget.connectionId,
    projectId,
    target: resolvedTarget.target,
    permissions,
  });
}

function defaultCheckoutName(target: CheckoutTargetSelection): string | undefined {
  return 'defaultCheckout' in target ? (target.defaultCheckout.lookupName ?? undefined) : undefined;
}

function assertManagedCheckoutTarget(
  checkout: CheckoutConfig,
  defaults: ProjectCheckoutDefaults,
  stepId: string,
): void {
  if (checkout.project !== undefined) return;
  if (checkout.repository === undefined && defaults.defaultCheckout === null) {
    throw new CheckoutConfigInvalidError(
      stepId,
      'Checkout on a managed project needs a repository written as owner/name, unless its access names exactly one repository',
    );
  }
  if (checkout.repository !== undefined && !checkout.repository.includes('/')) {
    throw new CheckoutConfigInvalidError(
      stepId,
      'Checkout on a managed project needs a repository written as owner/name',
    );
  }
}

async function resolveCheckoutTargetSelection(params: {
  target: CheckoutTargetSelection;
  workspaceId: string;
  defaultProject: Parameters<typeof repositoryCheckoutTarget>[0]['defaultProject'];
  projects: ProjectsModuleClient;
  stepId: string;
}): Promise<ResolvedCheckoutTarget | undefined> {
  const {target, defaultProject} = params;
  if ('project' in target) {
    return await params.projects.resolveCheckoutTarget({workspaceId: params.workspaceId, target});
  }
  if ('defaultCheckout' in target) {
    return {
      connectionId: target.defaultCheckout.connectionId,
      target: {
        kind: 'external-id',
        externalRepositoryId: target.defaultCheckout.externalRepositoryId,
      },
    };
  }
  return repositoryCheckoutTarget({
    connectionId: target.connection ?? defaultProject.sourceConnectionId,
    defaultProject,
    repository: repositoryTarget(
      target.repository,
      defaultOwner(defaultProject.sourceRepositoryOwner, target.repository),
      params.stepId,
    ),
  });
}

export function renewStepCheckoutCredentials({
  integrations,
  workspaceId,
  subject,
  rejectedGeneration,
}: {
  integrations: Pick<IntegrationsModuleClient, 'createCheckoutCredentials'>;
  workspaceId: string;
  subject: Pick<
    CheckoutRenewalSubject,
    'connectionId' | 'projectId' | 'externalRepositoryId' | 'permissions'
  >;
  rejectedGeneration?: string | undefined;
}) {
  return integrations.createCheckoutCredentials({
    workspaceId,
    connectionId: subject.connectionId,
    projectId: subject.projectId,
    externalRepositoryId: subject.externalRepositoryId,
    permissions: subject.permissions,
    ...(rejectedGeneration === undefined ? {} : {rejectedGeneration}),
  });
}

const EDGE_SLASHES_RE = /^\/+|\/+$/gu;
const GIT_SUFFIX_RE = /\.git$/u;

/** The `owner/name` path of a normalized repository URL. */
export function repositoryNameFromUrl(repositoryUrl: string): string | undefined {
  try {
    const path = new URL(repositoryUrl).pathname
      .replace(EDGE_SLASHES_RE, '')
      .replace(GIT_SUFFIX_RE, '');
    return path.includes('/') ? path : undefined;
  } catch {
    return undefined;
  }
}

function resolvedRepositoryName(
  resolved: {
    projectId?: string | undefined;
    sourceRepositoryOwner?: string | null | undefined;
    sourceRepositoryName?: string | null | undefined;
    target:
      | {kind: 'external-id'; externalRepositoryId: string}
      | {kind: 'name'; owner: string; name: string};
  },
  defaultProject: {
    id: string;
    sourceRepositoryOwner?: string | null | undefined;
    sourceRepositoryName?: string | null | undefined;
  },
): string | undefined {
  if (resolved.target.kind === 'name') return `${resolved.target.owner}/${resolved.target.name}`;
  if (resolved.sourceRepositoryOwner && resolved.sourceRepositoryName) {
    return `${resolved.sourceRepositoryOwner}/${resolved.sourceRepositoryName}`;
  }
  const {sourceRepositoryOwner: owner, sourceRepositoryName: name} = defaultProject;
  if (resolved.projectId === defaultProject.id && owner && name) return `${owner}/${name}`;
  return undefined;
}

type ResolvedCheckoutTarget = {
  projectId?: string | undefined;
  connectionId: string;
  target:
    | {kind: 'external-id'; externalRepositoryId: string}
    | {kind: 'name'; owner: string; name: string};
};

function resolveCheckoutRef(params: {
  checkout: CheckoutConfig;
  triggerReference: WorkflowRunTriggerReference | null | undefined;
  run: WorkflowRunOriginState;
  resolvedTarget: ResolvedCheckoutTarget;
  projectId: string;
}): string | undefined {
  // Explicit step refs win, followed by the commit of an event from the checked-out repository
  // (including replays), then the pinned dev commit for the run's own config repository. Other
  // targets intentionally use the provider default branch.
  const triggerCommitRef = triggerMatchesTarget(params.triggerReference, params.resolvedTarget)
    ? (params.triggerReference?.commit ?? undefined)
    : undefined;
  let devCommitRef: string | undefined;
  if (
    params.run.origin === 'dev' &&
    params.resolvedTarget.projectId !== undefined &&
    params.resolvedTarget.projectId === params.projectId
  ) {
    devCommitRef = params.run.devSource.commit;
  }
  return params.checkout.ref ?? triggerCommitRef ?? devCommitRef;
}

// The event's repository must be the checked-out repository, never just the project's. A run
// stored before the trigger reference named its connection and repository can only be compared
// by project.
function triggerMatchesTarget(
  triggerReference: WorkflowRunTriggerReference | null | undefined,
  resolvedTarget: ResolvedCheckoutTarget,
): boolean {
  if (triggerReference === null || triggerReference === undefined) return false;
  const {connectionId, externalRepositoryId} = triggerReference;
  if (connectionId === undefined || externalRepositoryId === undefined) {
    return (
      resolvedTarget.projectId !== undefined &&
      triggerReference.project?.id === resolvedTarget.projectId
    );
  }
  if (connectionId !== resolvedTarget.connectionId) return false;
  const {target} = resolvedTarget;
  if (target.kind === 'external-id') return target.externalRepositoryId === externalRepositoryId;
  return (
    triggerReference.repository?.toLowerCase() === `${target.owner}/${target.name}`.toLowerCase()
  );
}

type CheckoutSpecResponse = Awaited<ReturnType<IntegrationsModuleClient['createCheckoutSpec']>>;

function checkoutResult(
  checkout: CheckoutConfig,
  response: CheckoutSpecResponse,
  target: Pick<CheckoutRenewalSubject, 'connectionId' | 'projectId' | 'permissions'> & {
    target:
      | {kind: 'external-id'; externalRepositoryId: string}
      | {kind: 'name'; owner: string; name: string};
  },
) {
  const credentials = checkoutCredentials(response.credentials);
  const persistCredentials = checkout.persist_credentials ?? true;
  const renewalTarget = response.target ?? target.target;
  const renewalSubject =
    credentials === undefined || renewalTarget.kind !== 'external-id'
      ? undefined
      : {
          repositoryUrl: normalizeRepositoryUrl(response.repositoryUrl),
          connectionId: target.connectionId,
          projectId: target.projectId,
          externalRepositoryId: renewalTarget.externalRepositoryId,
          permissions: target.permissions,
        };
  return {
    spec: {
      repositoryUrl: response.repositoryUrl,
      ref: response.ref,
      ...(credentials === undefined ? {} : {credentials}),
      ...(response.gitAuthor === undefined ? {} : {gitAuthor: response.gitAuthor}),
    },
    fetchDepth: checkout.fetch_depth ?? 1,
    persistCredentials,
    ...(renewalSubject === undefined ? {} : {renewalSubject}),
  };
}

function checkoutCredentials(credentials: CheckoutSpecResponse['credentials']) {
  if (credentials === undefined) return undefined;
  const renewal = checkoutCredentialRenewal(credentials.renewal);
  return {
    username: credentials.username,
    token: credentials.token,
    expiresAt: new Date(credentials.expiresAt),
    ...(credentials.generation === undefined ? {} : {generation: credentials.generation}),
    ...(renewal === undefined ? {} : {renewal}),
  };
}

function checkoutCredentialRenewal(
  renewal: NonNullable<CheckoutSpecResponse['credentials']>['renewal'],
) {
  if (renewal === undefined) return undefined;
  if (renewal.mode === 'refresh-at') {
    return {mode: 'refresh-at' as const, refreshAt: new Date(renewal.refreshAt)};
  }
  return {mode: 'on-rejection' as const};
}

function parseCheckoutConfig(step: Step): CheckoutConfig {
  const result = checkoutConfigSchema.safeParse(step.config.checkout);
  if (!result.success) {
    throw new CheckoutConfigInvalidError(step.id);
  }
  return result.data;
}

type CheckoutTargetSelection =
  | {project: string}
  | {defaultCheckout: NonNullable<ProjectCheckoutDefaults['defaultCheckout']>}
  | {connection?: string | undefined; repository: string};

const noDefaults: ProjectCheckoutDefaults = {defaultCheckout: null, defaultConnectionId: null};

async function checkoutTarget(params: {
  checkout: CheckoutConfig;
  defaultProjectId: string;
  defaultConnectionId: string;
  managedDefaults: ProjectCheckoutDefaults | undefined;
  integrations: IntegrationsModuleClient;
  workspaceId: string;
  stepId: string;
}): Promise<CheckoutTargetSelection> {
  const {checkout, managedDefaults} = params;
  if (checkout.project !== undefined) return {project: checkout.project};
  if (checkout.repository !== undefined) {
    let connection: string | undefined;
    if (checkout.connection !== undefined) {
      connection = await resolveConnectionId({
        integrations: params.integrations,
        workspaceId: params.workspaceId,
        defaultConnectionId: params.defaultConnectionId,
        slug: checkout.connection,
      });
    } else if (managedDefaults !== undefined) {
      connection = defaultConnectionOf(managedDefaults, params.stepId);
    }
    return connection === undefined
      ? {repository: checkout.repository}
      : {connection, repository: checkout.repository};
  }
  if (managedDefaults?.defaultCheckout) return {defaultCheckout: managedDefaults.defaultCheckout};
  return {project: params.defaultProjectId};
}

// A managed project has no source connection to default to, so a repository without a connection
// uses the one its access lists, or the only one the workspace has.
function defaultConnectionOf(defaults: ProjectCheckoutDefaults, stepId: string): string {
  if (defaults.defaultConnectionId === null) {
    throw new CheckoutConfigInvalidError(
      stepId,
      'Checkout on a managed project needs a `connection` when its access lists no single source-control connection and the workspace has none or several',
    );
  }
  return defaults.defaultConnectionId;
}

function repositoryTarget(
  repository: string,
  defaultOwnerValue: string,
  stepId: string,
): {kind: 'name'; owner: string; name: string} {
  const separator = repository.indexOf('/');
  if (
    separator === 0 ||
    separator === repository.length - 1 ||
    repository.indexOf('/', separator + 1) !== -1
  ) {
    throw new CheckoutConfigInvalidError(stepId);
  }
  return separator === -1
    ? {kind: 'name', owner: defaultOwnerValue, name: repository}
    : {
        kind: 'name',
        owner: repository.slice(0, separator),
        name: repository.slice(separator + 1),
      };
}

function repositoryCheckoutTarget(params: {
  connectionId: string;
  defaultProject: {
    id: string;
    sourceConnectionId: string;
    sourceExternalRepositoryId: string;
    sourceRepositoryOwner?: string | null | undefined;
    sourceRepositoryName?: string | null | undefined;
  };
  repository: {kind: 'name'; owner: string; name: string};
}) {
  const isSameProjectRepository =
    params.connectionId === params.defaultProject.sourceConnectionId &&
    params.defaultProject.sourceRepositoryOwner !== null &&
    params.defaultProject.sourceRepositoryOwner !== undefined &&
    params.defaultProject.sourceRepositoryName !== null &&
    params.defaultProject.sourceRepositoryName !== undefined &&
    params.repository.owner.toLowerCase() ===
      params.defaultProject.sourceRepositoryOwner.toLowerCase() &&
    params.repository.name.toLowerCase() ===
      params.defaultProject.sourceRepositoryName.toLowerCase();

  if (isSameProjectRepository) {
    return {
      projectId: params.defaultProject.id,
      connectionId: params.connectionId,
      target: {
        kind: 'external-id' as const,
        externalRepositoryId: params.defaultProject.sourceExternalRepositoryId,
      },
    };
  }

  return {connectionId: params.connectionId, target: params.repository};
}

async function resolveConnectionId(params: {
  integrations: IntegrationsModuleClient;
  workspaceId: string;
  defaultConnectionId: string;
  slug: string;
}): Promise<string> {
  const connection = await params.integrations.resolveConnection({
    workspaceId: params.workspaceId,
    slug: params.slug,
  });
  if (connection === null) {
    throw new CheckoutIntentUnresolvedError({kind: 'connection', value: params.slug});
  }
  return connection.id;
}

function defaultOwner(
  projectOwner: string | null | undefined,
  repository: string | undefined,
): string {
  if (projectOwner) return projectOwner;
  const separator = repository?.indexOf('/') ?? -1;
  if (separator > 0 && repository !== undefined) return repository.slice(0, separator);
  return 'unknown';
}
