import type {ExpressionTypeEnvironment} from '../expression/workflow-expression.js';

export const workflowContextNames = [
  'run',
  'trigger',
  'event',
  'inputs',
  'job',
  'executions',
  'execution',
  'steps',
  'step',
  'vars',
  'secrets',
] as const;
export type WorkflowContextName = (typeof workflowContextNames)[number];

export const availabilitySites = [
  // Server receives an external trigger or manual request before a run row exists.
  'ingest',
  // Server creates the workflow run and its run-scoped context.
  'run-creation',
  // Server creates a concrete job execution and its execution-scoped context.
  'execution-creation',
  // Server activates a queued job after dependencies, matrix expansion, and runner demand are known.
  'job-activation',
  // Server dispatches a job step to a runner with all server-filled context resolved.
  'step-dispatch',
  // Server receives a step report and makes step result context available.
  'step-report',
  // Server resolves one job execution after its steps have settled.
  'execution-resolution',
  // Server resolves the job after all of its executions are known.
  'job-resolution',
] as const;
export type AvailabilitySite = (typeof availabilitySites)[number];

export const runnerFillTarget = 'runner-fill';
export type FillTarget = AvailabilitySite | typeof runnerFillTarget;

export const workflowContextSensitivities = ['persistable', 'ephemeral'] as const;
export type WorkflowContextSensitivity = (typeof workflowContextSensitivities)[number];

export const workflowContextHosts = ['server', 'runner'] as const;
export type WorkflowContextHost = (typeof workflowContextHosts)[number];

export type ReservedRootDefinition =
  | {readonly host: 'server'; readonly availability: AvailabilitySite}
  | {readonly host: 'runner'};

export const workflowContextReservedRoots = {
  jobs: {host: 'server', availability: 'job-resolution'},
  matrix: {host: 'server', availability: 'job-activation'},
  runner: {host: 'runner'},
} as const satisfies Record<string, ReservedRootDefinition>;
export type WorkflowContextReservedRoot = keyof typeof workflowContextReservedRoots;

export const workflowContextTrustTiers = ['trusted', 'untrusted'] as const;
export type WorkflowContextTrustTier = (typeof workflowContextTrustTiers)[number];

export type WorkflowContextShape = 'known' | 'open';

export interface TypedWorkflowContextDefinition {
  readonly availability: AvailabilitySite;
  readonly trustTier: WorkflowContextTrustTier;
  readonly sensitivity: WorkflowContextSensitivity;
  readonly host: 'server';
  readonly shape: 'known';
  readonly checkMode: 'typed';
  readonly typeEnvironment: ExpressionTypeEnvironment;
  readonly untrustedPaths?: readonly string[];
}

export interface OpenWorkflowContextDefinition {
  readonly availability: AvailabilitySite;
  readonly trustTier: WorkflowContextTrustTier;
  readonly sensitivity: WorkflowContextSensitivity;
  readonly host: 'server';
  readonly shape: 'open';
  readonly checkMode: 'syntax';
  readonly literalKeyOnly?: boolean;
}

export interface RunnerWorkflowContextDefinition {
  readonly trustTier: WorkflowContextTrustTier;
  readonly sensitivity: 'ephemeral';
  readonly host: 'runner';
  readonly shape: 'open';
  readonly checkMode: 'syntax';
  readonly literalKeyOnly?: boolean;
}

export type WorkflowContextDefinition =
  | TypedWorkflowContextDefinition
  | OpenWorkflowContextDefinition
  | RunnerWorkflowContextDefinition;

const runTypeEnvironment = {
  run: {
    kind: 'object',
    fields: {
      id: 'string',
      name: 'string',
      definition_id: 'string',
      project_id: 'string',
      workspace_id: 'string',
      created_at: 'timestamp',
    },
  },
} as const satisfies ExpressionTypeEnvironment;

const triggerTypeEnvironment = {
  trigger: {
    kind: 'object',
    fields: {
      source: 'string',
      event: 'string',
    },
  },
} as const satisfies ExpressionTypeEnvironment;

const jobTypeEnvironment = {
  job: {
    kind: 'object',
    fields: {
      key: 'string',
    },
  },
} as const satisfies ExpressionTypeEnvironment;

const executionEventType = {
  kind: 'object',
  fields: {
    source: 'string',
    event: 'string',
    delivery_id: 'string',
    received_at: 'timestamp',
    data: {
      kind: 'object',
      fields: {},
    },
  },
} as const;

const executionType = {
  kind: 'object',
  fields: {
    index: 'int',
    name: 'string',
    status: 'string',
    started_at: 'timestamp',
    finished_at: 'timestamp',
    events: {
      kind: 'list',
      element: executionEventType,
    },
  },
} as const;

const executionsTypeEnvironment = {
  executions: {
    kind: 'list',
    element: executionType,
  },
} as const satisfies ExpressionTypeEnvironment;

const executionTypeEnvironment = {
  execution: executionType,
} as const satisfies ExpressionTypeEnvironment;

const stepTypeEnvironment = {
  step: {
    kind: 'object',
    fields: {
      exit_code: 'int',
      status: 'string',
      outputs: {kind: 'map'},
    },
  },
} as const satisfies ExpressionTypeEnvironment;

export const workflowContextDefinitions = {
  run: {
    availability: 'run-creation',
    trustTier: 'trusted',
    sensitivity: 'persistable',
    host: 'server',
    shape: 'known',
    checkMode: 'typed',
    typeEnvironment: runTypeEnvironment,
  },
  trigger: {
    availability: 'run-creation',
    trustTier: 'trusted',
    sensitivity: 'persistable',
    host: 'server',
    shape: 'known',
    checkMode: 'typed',
    typeEnvironment: triggerTypeEnvironment,
  },
  event: {
    availability: 'run-creation',
    trustTier: 'untrusted',
    sensitivity: 'persistable',
    host: 'server',
    shape: 'open',
    checkMode: 'syntax',
  },
  inputs: {
    availability: 'run-creation',
    trustTier: 'untrusted',
    sensitivity: 'persistable',
    host: 'server',
    shape: 'open',
    checkMode: 'syntax',
  },
  job: {
    availability: 'run-creation',
    trustTier: 'trusted',
    sensitivity: 'persistable',
    host: 'server',
    shape: 'known',
    checkMode: 'typed',
    typeEnvironment: jobTypeEnvironment,
  },
  executions: {
    availability: 'execution-creation',
    trustTier: 'trusted',
    sensitivity: 'persistable',
    host: 'server',
    shape: 'known',
    checkMode: 'typed',
    typeEnvironment: executionsTypeEnvironment,
    untrustedPaths: ['events'],
  },
  execution: {
    availability: 'execution-creation',
    trustTier: 'trusted',
    sensitivity: 'persistable',
    host: 'server',
    shape: 'known',
    checkMode: 'typed',
    typeEnvironment: executionTypeEnvironment,
    untrustedPaths: ['events'],
  },
  steps: {
    availability: 'step-dispatch',
    trustTier: 'trusted',
    sensitivity: 'persistable',
    host: 'server',
    shape: 'open',
    checkMode: 'syntax',
  },
  step: {
    availability: 'step-report',
    trustTier: 'trusted',
    sensitivity: 'persistable',
    host: 'server',
    shape: 'known',
    checkMode: 'typed',
    typeEnvironment: stepTypeEnvironment,
    untrustedPaths: ['outputs'],
  },
  vars: {
    availability: 'run-creation',
    trustTier: 'trusted',
    sensitivity: 'persistable',
    host: 'server',
    shape: 'open',
    checkMode: 'syntax',
    literalKeyOnly: true,
  },
  secrets: {
    trustTier: 'trusted',
    sensitivity: 'ephemeral',
    host: 'runner',
    shape: 'open',
    checkMode: 'syntax',
    literalKeyOnly: true,
  },
} as const satisfies Record<WorkflowContextName, WorkflowContextDefinition>;

export type WorkflowInterpolationField =
  | 'run'
  | 'env.value'
  | 'agent.prompt'
  | 'agent.model'
  | 'agent.provider'
  | 'agent.thinking'
  | 'job.runner'
  | 'job.name'
  | 'step.name';

export const workflowFieldFailurePolicies = ['fail', 'degrade', 'fail-closed'] as const;
export type WorkflowFieldFailurePolicy = (typeof workflowFieldFailurePolicies)[number];
export type WorkflowInterpolationFailurePolicy = Exclude<WorkflowFieldFailurePolicy, 'fail-closed'>;

export interface WorkflowInterpolationFieldPolicy {
  readonly acceptedTrustTiers: readonly WorkflowContextTrustTier[];
  readonly acceptedHosts: readonly WorkflowContextHost[];
  readonly failurePolicy: WorkflowInterpolationFailurePolicy;
  readonly renderSanitize: boolean;
}

const trustedOnlyTrustTiers: readonly WorkflowContextTrustTier[] = ['trusted'];
const anyTrustTier: readonly WorkflowContextTrustTier[] = ['trusted', 'untrusted'];
const serverOnlyHosts: readonly WorkflowContextHost[] = ['server'];
const anyHost: readonly WorkflowContextHost[] = ['server', 'runner'];

export const workflowInterpolationFieldPolicies = {
  run: {
    acceptedTrustTiers: trustedOnlyTrustTiers,
    acceptedHosts: anyHost,
    failurePolicy: 'fail',
    renderSanitize: false,
  },
  'env.value': {
    acceptedTrustTiers: anyTrustTier,
    acceptedHosts: anyHost,
    failurePolicy: 'fail',
    renderSanitize: false,
  },
  'agent.prompt': {
    acceptedTrustTiers: anyTrustTier,
    acceptedHosts: serverOnlyHosts,
    failurePolicy: 'fail',
    renderSanitize: false,
  },
  'agent.model': {
    acceptedTrustTiers: trustedOnlyTrustTiers,
    acceptedHosts: serverOnlyHosts,
    failurePolicy: 'fail',
    renderSanitize: false,
  },
  'agent.provider': {
    acceptedTrustTiers: trustedOnlyTrustTiers,
    acceptedHosts: serverOnlyHosts,
    failurePolicy: 'fail',
    renderSanitize: false,
  },
  'agent.thinking': {
    acceptedTrustTiers: trustedOnlyTrustTiers,
    acceptedHosts: serverOnlyHosts,
    failurePolicy: 'fail',
    renderSanitize: false,
  },
  'job.runner': {
    acceptedTrustTiers: anyTrustTier,
    acceptedHosts: serverOnlyHosts,
    failurePolicy: 'fail',
    renderSanitize: false,
  },
  'job.name': {
    acceptedTrustTiers: anyTrustTier,
    acceptedHosts: serverOnlyHosts,
    failurePolicy: 'degrade',
    renderSanitize: true,
  },
  'step.name': {
    acceptedTrustTiers: anyTrustTier,
    acceptedHosts: serverOnlyHosts,
    failurePolicy: 'degrade',
    renderSanitize: true,
  },
} as const satisfies Record<WorkflowInterpolationField, WorkflowInterpolationFieldPolicy>;

export const workflowInterpolationFields = Object.keys(
  workflowInterpolationFieldPolicies,
) as readonly WorkflowInterpolationField[];

export const workflowPredicateFields = ['step.success', 'job.success'] as const;
export type WorkflowPredicateField = (typeof workflowPredicateFields)[number];

export const workflowPredicateFieldFailurePolicy =
  'fail-closed' as const satisfies WorkflowFieldFailurePolicy;

export function getWorkflowContextDefinition(name: WorkflowContextName): WorkflowContextDefinition {
  return workflowContextDefinitions[name];
}

export function getWorkflowContextAvailability(
  name: WorkflowContextName,
): AvailabilitySite | undefined {
  const definition = workflowContextDefinitions[name];
  return definition.host === 'server' ? definition.availability : undefined;
}

export function getWorkflowContextHost(name: WorkflowContextName): WorkflowContextHost {
  return workflowContextDefinitions[name].host;
}

export function resolveContextRootHost(root: string): WorkflowContextHost | undefined {
  if (isWorkflowContextName(root)) return workflowContextDefinitions[root].host;
  if (isWorkflowContextReservedRoot(root)) return workflowContextReservedRoots[root].host;
  return undefined;
}

export function resolveContextRootAvailability(root: string): AvailabilitySite | undefined {
  if (isWorkflowContextName(root)) {
    const definition = workflowContextDefinitions[root];
    return definition.host === 'server' ? definition.availability : undefined;
  }

  if (!isWorkflowContextReservedRoot(root)) return undefined;
  const reservedRoot = workflowContextReservedRoots[root];
  return reservedRoot.host === 'server' ? reservedRoot.availability : undefined;
}

export function getWorkflowContextSensitivity(
  name: WorkflowContextName,
): WorkflowContextSensitivity {
  return workflowContextDefinitions[name].sensitivity;
}

export function rootsAvailableAt(site: AvailabilitySite): readonly WorkflowContextName[] {
  const targetSiteIndex = availabilitySites.indexOf(site);
  return workflowContextNames.filter((name) => {
    const definition = workflowContextDefinitions[name];
    return (
      definition.host === 'server' &&
      availabilitySites.indexOf(definition.availability) <= targetSiteIndex
    );
  });
}

export function unavailableRootsAt(
  roots: readonly WorkflowContextName[],
  site: AvailabilitySite,
): readonly WorkflowContextName[] {
  const availableRoots = new Set(rootsAvailableAt(site));
  return roots.filter((root) => !availableRoots.has(root));
}

export function getWorkflowContextTypeEnvironment(
  name: WorkflowContextName,
): ExpressionTypeEnvironment | undefined {
  const context = getWorkflowContextDefinition(name);
  return context.shape === 'known' ? context.typeEnvironment : undefined;
}

export function getWorkflowContextUntrustedPaths(
  name: WorkflowContextName,
): readonly string[] | undefined {
  const context = getWorkflowContextDefinition(name);
  return context.shape === 'known' ? context.untrustedPaths : undefined;
}

export function workflowInterpolationFieldAcceptsTrustTier(
  field: WorkflowInterpolationField,
  trustTier: WorkflowContextTrustTier,
): boolean {
  return workflowInterpolationFieldPolicies[field].acceptedTrustTiers.includes(trustTier);
}

export function workflowInterpolationFieldAcceptsHost(
  field: WorkflowInterpolationField,
  host: WorkflowContextHost,
): boolean {
  return workflowInterpolationFieldPolicies[field].acceptedHosts.includes(host);
}

export function workflowInterpolationFieldAcceptsContext(
  field: WorkflowInterpolationField,
  context: WorkflowContextName,
): boolean {
  return workflowInterpolationFieldAcceptsTrustTier(
    field,
    workflowContextDefinitions[context].trustTier,
  );
}

export function workflowContextRootRequiresLiteralKey(root: string): boolean {
  if (!isWorkflowContextName(root)) return false;
  const definition = workflowContextDefinitions[root];
  return 'literalKeyOnly' in definition && definition.literalKeyOnly === true;
}

export function getWorkflowInterpolationFieldFailurePolicy(
  field: WorkflowInterpolationField,
): WorkflowInterpolationFailurePolicy {
  return workflowInterpolationFieldPolicies[field].failurePolicy;
}

export interface WorkflowContextAvailabilityReferenceEntry {
  readonly root: WorkflowContextName | WorkflowContextReservedRoot;
  readonly availability?: AvailabilitySite;
  readonly reserved: boolean;
  readonly availableAt: Readonly<Record<AvailabilitySite, boolean>>;
}

export function workflowContextAvailabilityReference(): readonly WorkflowContextAvailabilityReferenceEntry[] {
  return [
    ...workflowContextNames.map((root) => {
      const definition = workflowContextDefinitions[root];
      if (definition.host === 'runner') return noServerAvailabilityReferenceEntry(root, false);
      return availabilityReferenceEntry(root, definition.availability, false);
    }),
    ...Object.entries(workflowContextReservedRoots).map(([root, definition]) => {
      if (definition.host === 'runner') {
        return noServerAvailabilityReferenceEntry(root as WorkflowContextReservedRoot, true);
      }
      return availabilityReferenceEntry(
        root as WorkflowContextReservedRoot,
        definition.availability,
        true,
      );
    }),
  ];
}

function availabilityReferenceEntry(
  root: WorkflowContextName | WorkflowContextReservedRoot,
  availability: AvailabilitySite,
  reserved: boolean,
): WorkflowContextAvailabilityReferenceEntry {
  const availabilityIndex = availabilitySites.indexOf(availability);
  const availableAt = Object.fromEntries(
    availabilitySites.map((site) => [site, availabilitySites.indexOf(site) >= availabilityIndex]),
  ) as Record<AvailabilitySite, boolean>;

  return {root, availability, reserved, availableAt};
}

function noServerAvailabilityReferenceEntry(
  root: WorkflowContextName | WorkflowContextReservedRoot,
  reserved: boolean,
): WorkflowContextAvailabilityReferenceEntry {
  const availableAt = Object.fromEntries(availabilitySites.map((site) => [site, false])) as Record<
    AvailabilitySite,
    boolean
  >;

  return {root, reserved, availableAt};
}

function isWorkflowContextName(root: string): root is WorkflowContextName {
  return Object.hasOwn(workflowContextDefinitions, root);
}

function isWorkflowContextReservedRoot(root: string): root is WorkflowContextReservedRoot {
  return Object.hasOwn(workflowContextReservedRoots, root);
}
