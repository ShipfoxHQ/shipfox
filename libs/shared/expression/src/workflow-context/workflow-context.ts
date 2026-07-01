import type {ExpressionTypeEnvironment} from '../expression/workflow-expression.js';

export const workflowContextNames = [
  'run',
  'trigger',
  'event',
  'inputs',
  'job',
  'executions',
  'execution',
] as const;
export type WorkflowContextName = (typeof workflowContextNames)[number];

export const workflowContextPhases = [
  'workflow-run-creation',
  'job-execution-creation',
  'step-completion',
  'job-resolution',
] as const;
export type WorkflowContextPhase = (typeof workflowContextPhases)[number];

export const workflowContextReservedRoots = {
  step: 'step-completion',
  steps: 'step-completion',
  jobs: 'job-resolution',
} as const satisfies Record<string, WorkflowContextPhase>;
export type WorkflowContextReservedRoot = keyof typeof workflowContextReservedRoots;

export const workflowContextTrustTiers = ['trusted', 'untrusted'] as const;
export type WorkflowContextTrustTier = (typeof workflowContextTrustTiers)[number];

export type WorkflowContextShape = 'known' | 'open';

export interface TypedWorkflowContextDefinition {
  readonly availability: WorkflowContextPhase;
  readonly trustTier: WorkflowContextTrustTier;
  readonly shape: 'known';
  readonly checkMode: 'typed';
  readonly typeEnvironment: ExpressionTypeEnvironment;
  readonly untrustedPaths?: readonly string[];
}

export interface OpenWorkflowContextDefinition {
  readonly availability: WorkflowContextPhase;
  readonly trustTier: WorkflowContextTrustTier;
  readonly shape: 'open';
  readonly checkMode: 'syntax';
}

export type WorkflowContextDefinition =
  | TypedWorkflowContextDefinition
  | OpenWorkflowContextDefinition;

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

export const workflowContextDefinitions = {
  run: {
    availability: 'workflow-run-creation',
    trustTier: 'trusted',
    shape: 'known',
    checkMode: 'typed',
    typeEnvironment: runTypeEnvironment,
  },
  trigger: {
    availability: 'workflow-run-creation',
    trustTier: 'trusted',
    shape: 'known',
    checkMode: 'typed',
    typeEnvironment: triggerTypeEnvironment,
  },
  event: {
    availability: 'workflow-run-creation',
    trustTier: 'untrusted',
    shape: 'open',
    checkMode: 'syntax',
  },
  inputs: {
    availability: 'workflow-run-creation',
    trustTier: 'untrusted',
    shape: 'open',
    checkMode: 'syntax',
  },
  job: {
    availability: 'workflow-run-creation',
    trustTier: 'trusted',
    shape: 'known',
    checkMode: 'typed',
    typeEnvironment: jobTypeEnvironment,
  },
  executions: {
    availability: 'job-execution-creation',
    trustTier: 'trusted',
    shape: 'known',
    checkMode: 'typed',
    typeEnvironment: executionsTypeEnvironment,
    untrustedPaths: ['events'],
  },
  execution: {
    availability: 'job-execution-creation',
    trustTier: 'trusted',
    shape: 'known',
    checkMode: 'typed',
    typeEnvironment: executionTypeEnvironment,
    untrustedPaths: ['events'],
  },
} as const satisfies Record<WorkflowContextName, WorkflowContextDefinition>;

export type WorkflowInterpolationField =
  | 'run'
  | 'env.value'
  | 'agent.prompt'
  | 'agent.model'
  | 'agent.provider'
  | 'agent.thinking'
  | 'job.name'
  | 'step.name';

export interface WorkflowInterpolationFieldPolicy {
  readonly acceptedTrustTiers: readonly WorkflowContextTrustTier[];
  readonly renderSanitize: boolean;
}

const trustedOnlyTrustTiers: readonly WorkflowContextTrustTier[] = ['trusted'];
const anyTrustTier: readonly WorkflowContextTrustTier[] = ['trusted', 'untrusted'];

export const workflowInterpolationFieldPolicies = {
  run: {
    acceptedTrustTiers: trustedOnlyTrustTiers,
    renderSanitize: false,
  },
  'env.value': {
    acceptedTrustTiers: anyTrustTier,
    renderSanitize: false,
  },
  'agent.prompt': {
    acceptedTrustTiers: anyTrustTier,
    renderSanitize: false,
  },
  'agent.model': {
    acceptedTrustTiers: trustedOnlyTrustTiers,
    renderSanitize: false,
  },
  'agent.provider': {
    acceptedTrustTiers: trustedOnlyTrustTiers,
    renderSanitize: false,
  },
  'agent.thinking': {
    acceptedTrustTiers: trustedOnlyTrustTiers,
    renderSanitize: false,
  },
  'job.name': {
    acceptedTrustTiers: anyTrustTier,
    renderSanitize: true,
  },
  'step.name': {
    acceptedTrustTiers: anyTrustTier,
    renderSanitize: true,
  },
} as const satisfies Record<WorkflowInterpolationField, WorkflowInterpolationFieldPolicy>;

export const workflowInterpolationFields = Object.keys(
  workflowInterpolationFieldPolicies,
) as readonly WorkflowInterpolationField[];

export function getWorkflowContextDefinition(name: WorkflowContextName): WorkflowContextDefinition {
  return workflowContextDefinitions[name];
}

export function getWorkflowContextAvailability(name: WorkflowContextName): WorkflowContextPhase {
  return workflowContextDefinitions[name].availability;
}

export function rootsAvailableAt(phase: WorkflowContextPhase): readonly WorkflowContextName[] {
  const targetPhaseIndex = workflowContextPhases.indexOf(phase);
  return workflowContextNames.filter(
    (name) =>
      workflowContextPhases.indexOf(workflowContextDefinitions[name].availability) <=
      targetPhaseIndex,
  );
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

export function workflowInterpolationFieldAcceptsContext(
  field: WorkflowInterpolationField,
  context: WorkflowContextName,
): boolean {
  return workflowInterpolationFieldAcceptsTrustTier(
    field,
    workflowContextDefinitions[context].trustTier,
  );
}

export interface WorkflowContextAvailabilityReferenceEntry {
  readonly root: WorkflowContextName | WorkflowContextReservedRoot;
  readonly availability: WorkflowContextPhase;
  readonly reserved: boolean;
  readonly availableAt: Readonly<Record<WorkflowContextPhase, boolean>>;
}

export function workflowContextAvailabilityReference(): readonly WorkflowContextAvailabilityReferenceEntry[] {
  return [
    ...workflowContextNames.map((root) =>
      availabilityReferenceEntry(root, workflowContextDefinitions[root].availability, false),
    ),
    ...Object.entries(workflowContextReservedRoots).map(([root, availability]) =>
      availabilityReferenceEntry(root as WorkflowContextReservedRoot, availability, true),
    ),
  ];
}

function availabilityReferenceEntry(
  root: WorkflowContextName | WorkflowContextReservedRoot,
  availability: WorkflowContextPhase,
  reserved: boolean,
): WorkflowContextAvailabilityReferenceEntry {
  const availabilityIndex = workflowContextPhases.indexOf(availability);
  const availableAt = Object.fromEntries(
    workflowContextPhases.map((phase) => [
      phase,
      workflowContextPhases.indexOf(phase) >= availabilityIndex,
    ]),
  ) as Record<WorkflowContextPhase, boolean>;

  return {root, availability, reserved, availableAt};
}
