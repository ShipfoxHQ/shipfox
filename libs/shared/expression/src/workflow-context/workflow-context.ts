import type {ExpressionTypeEnvironment} from '../expression/workflow-expression.js';

export const workflowContextNames = ['run', 'trigger', 'event', 'inputs', 'job'] as const;
export type WorkflowContextName = (typeof workflowContextNames)[number];

export const workflowContextTrustTiers = ['trusted', 'untrusted'] as const;
export type WorkflowContextTrustTier = (typeof workflowContextTrustTiers)[number];

export type WorkflowContextShape = 'known' | 'open';

export interface TypedWorkflowContextDefinition {
  readonly trustTier: WorkflowContextTrustTier;
  readonly shape: 'known';
  readonly checkMode: 'typed';
  readonly typeEnvironment: ExpressionTypeEnvironment;
}

export interface OpenWorkflowContextDefinition {
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
      name: 'string',
    },
  },
} as const satisfies ExpressionTypeEnvironment;

export const workflowContextDefinitions = {
  run: {
    trustTier: 'trusted',
    shape: 'known',
    checkMode: 'typed',
    typeEnvironment: runTypeEnvironment,
  },
  trigger: {
    trustTier: 'trusted',
    shape: 'known',
    checkMode: 'typed',
    typeEnvironment: triggerTypeEnvironment,
  },
  event: {
    trustTier: 'untrusted',
    shape: 'open',
    checkMode: 'syntax',
  },
  inputs: {
    trustTier: 'untrusted',
    shape: 'open',
    checkMode: 'syntax',
  },
  job: {
    trustTier: 'trusted',
    shape: 'known',
    checkMode: 'typed',
    typeEnvironment: jobTypeEnvironment,
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

export function getWorkflowContextTypeEnvironment(
  name: WorkflowContextName,
): ExpressionTypeEnvironment | undefined {
  const context = getWorkflowContextDefinition(name);
  return context.shape === 'known' ? context.typeEnvironment : undefined;
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
