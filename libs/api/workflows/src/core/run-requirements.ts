import {
  WORKFLOW_MODEL_CHECKOUT_TARGET_FIELDS,
  type WorkflowJsonTemplateTree,
  type WorkflowModel,
} from '@shipfox/api-definitions-dto';
import {
  analyzeContextKeyAccess,
  type ResolvedFieldSegment,
  type WorkflowExpression,
} from '@shipfox/expression';
import type {InterpolationUnresolvableField} from './errors.js';

export type WorkflowModelJob = WorkflowModel['jobs'][number];
type WorkflowModelStep = WorkflowModelJob['steps'][number];

export interface RunRequirementStepLocation {
  readonly key?: string | undefined;
  readonly name?: string | undefined;
  /** 1-based position among the job's authored steps. */
  readonly index: number;
}

export interface RunRequirementLocation {
  readonly jobKey?: string | undefined;
  readonly step?: RunRequirementStepLocation | undefined;
}

interface RunRequirementReferenceBase extends RunRequirementLocation {
  readonly key: string;
  readonly field: InterpolationUnresolvableField;
  readonly source: string;
  readonly envKey?: string | undefined;
}

export type ReferencedVariable = RunRequirementReferenceBase;

export interface ReferencedSecret extends RunRequirementReferenceBase {
  readonly store: 'local' | 'inputs';
}

export interface RunRequirements {
  readonly variables: readonly ReferencedVariable[];
  readonly secrets: readonly ReferencedSecret[];
}

interface FieldSource {
  readonly field: InterpolationUnresolvableField;
  readonly envKey?: string | undefined;
}

interface Collected {
  readonly variables: ReferencedVariable[];
  readonly secrets: ReferencedSecret[];
}

interface Scope {
  readonly out: Collected;
  readonly location: RunRequirementLocation;
}

/**
 * Display-only names never fail a run when a variable they read is missing, so run creation
 * and readiness both skip them.
 */
export function variableReferenceIsRequired(reference: ReferencedVariable): boolean {
  return reference.field !== 'job.execution_name' && reference.field !== 'workflow.run_name';
}

/**
 * Collect every `vars.*` and `secrets.*` reference a workflow model reads, with where it
 * is read. References inside `has()` and either side of `?:`, `&&` and `||` count: the
 * analyzer walks every branch, so a workflow needs each key it names even when that
 * branch never runs.
 *
 * Predicates are read from every job of `model`, including listening filters. Templates
 * are read only from `jobs`, so a caller can scope them to the jobs it resolves.
 */
export function collectRunRequirements(
  model: WorkflowModel,
  jobs: readonly WorkflowModelJob[],
): RunRequirements {
  const out: Collected = {variables: [], secrets: []};
  const workflowScope: Scope = {out, location: {}};

  collectWorkflowPredicateReferences(model, out);
  collectFieldReferences(model.runName, workflowScope, {field: 'workflow.run_name'});
  collectFieldReferences(model.concurrency?.group, workflowScope, {
    field: 'workflow.concurrency.group',
  });
  collectTemplateReferences(model.outputs, workflowScope, {field: 'workflow.outputs'});
  if (jobs.length > 0) collectTemplateReferences(model.templates?.env, workflowScope);
  for (const job of jobs) collectJobReferences(job, out);
  return out;
}

function collectWorkflowPredicateReferences(model: WorkflowModel, out: Collected): void {
  for (const job of model.jobs) {
    const jobScope: Scope = {out, location: {jobKey: job.key}};
    collectPredicateReferences(job.if, jobScope, 'job.if');
    collectPredicateReferences(job.success, jobScope, 'job.success');

    for (const trigger of [...(job.listening?.on ?? []), ...(job.listening?.until ?? [])]) {
      collectPredicateReferences(trigger.filter, jobScope, 'job.listening.filter');
    }

    job.steps.forEach((step, index) => {
      const stepScope = stepScopeFor(jobScope, step, index);
      collectPredicateReferences(step.if, stepScope, 'step.if');
      collectPredicateReferences(step.gate?.success, stepScope, 'step.gate.success');
    });
  }
}

function collectJobReferences(job: WorkflowModelJob, out: Collected): void {
  const scope: Scope = {out, location: {jobKey: job.key}};
  collectFieldReferences(job.executionName, scope, {field: 'job.execution_name'});
  for (const template of job.runnerTemplates ?? []) {
    collectFieldReferences(template, scope, {field: 'job.runner'});
  }
  collectTemplateReferences(job.outputs, scope, {field: 'job.outputs'});
  collectTemplateReferences(job.templates?.env, scope);
  job.steps.forEach((step, index) => {
    collectStepReferences(step, stepScopeFor(scope, step, index));
  });
}

function stepScopeFor(jobScope: Scope, step: WorkflowModelStep, index: number): Scope {
  return {
    out: jobScope.out,
    location: {
      ...jobScope.location,
      step: {key: step.key, name: step.name, index: index + 1},
    },
  };
}

function collectStepReferences(step: WorkflowModelStep, scope: Scope): void {
  collectFieldReferences(step.templates?.name, scope, {field: 'step.name'});
  collectFieldReferences(
    step.kind === 'tool' ? undefined : step.templates?.workingDirectory,
    scope,
    {field: 'step.working_directory'},
  );
  switch (step.kind) {
    case 'run':
      collectFieldReferences(step.templates?.command, scope, {field: 'run'});
      collectTemplateReferences(step.templates?.env, scope);
      return;
    case 'agent':
      collectFieldReferences(step.templates?.prompt, scope, {field: 'agent.prompt'});
      collectFieldReferences(step.templates?.model, scope, {field: 'agent.model'});
      collectFieldReferences(step.templates?.provider, scope, {field: 'agent.provider'});
      collectFieldReferences(step.templates?.thinking, scope, {field: 'agent.thinking'});
      collectFieldReferences(step.session?.key, scope, {field: 'agent.session'});
      return;
    case 'tool':
      collectToolStepReferences(step, scope);
      return;
    case 'action':
      collectTemplateTreeReferences(step.templates?.with, scope, {field: 'action.with'});
      collectTemplateReferences(step.templates?.env, scope);
      return;
    case 'checkout':
      for (const [key, field] of WORKFLOW_MODEL_CHECKOUT_TARGET_FIELDS) {
        collectFieldReferences(step.checkout.templates?.[key], scope, {field});
      }
  }
}

function collectToolStepReferences(
  step: Extract<WorkflowModelStep, {kind: 'tool'}>,
  scope: Scope,
): void {
  collectTemplateTreeReferences(step.templates?.with, scope, {field: 'tool.with'});
  for (const [key, expression] of Object.entries(step.outputMappings ?? {})) {
    collectExpressionReferences(expression, scope, {field: 'tool.outputs', envKey: key});
  }
}

function collectPredicateReferences(
  expression: WorkflowExpression | string | undefined,
  scope: Scope,
  field: InterpolationUnresolvableField,
): void {
  if (expression === undefined) return;
  collectExpressionReferences(expression, scope, {field});
}

function collectTemplateReferences(
  templates: Readonly<Record<string, readonly ResolvedFieldSegment[]>> | undefined,
  scope: Scope,
  source?: {readonly field: InterpolationUnresolvableField},
): void {
  for (const [envKey, template] of Object.entries(templates ?? {})) {
    collectFieldReferences(template, scope, source === undefined ? {field: 'env', envKey} : source);
  }
}

function collectFieldReferences(
  template: readonly ResolvedFieldSegment[] | undefined,
  scope: Scope,
  source: FieldSource,
): void {
  for (const segment of template ?? []) {
    if (segment.kind === 'literal') continue;
    collectExpressionReferences(segment.expression, scope, source);
  }
}

/**
 * A `WorkflowJsonTemplateTree` mirrors the authored `with` payload with every
 * interpolated string leaf replaced by its parsed template, so walk it like
 * the authored structure and collect from each leaf template.
 */
function collectTemplateTreeReferences(
  tree: WorkflowJsonTemplateTree | undefined,
  scope: Scope,
  source: FieldSource,
): void {
  if (tree === undefined) return;

  if (Array.isArray(tree)) {
    // A field template is itself an array of segments; a `with` list is an
    // array of child trees. Segments carry a `kind`, so distinguish the two.
    if (tree.every((element) => isFieldTemplateSegment(element))) {
      collectFieldReferences(tree, scope, source);
      return;
    }
    for (const child of tree) collectTemplateTreeReferences(child, scope, source);
    return;
  }

  if (typeof tree === 'object') {
    for (const child of Object.values(tree)) collectTemplateTreeReferences(child, scope, source);
  }
}

function isFieldTemplateSegment(value: unknown): value is ResolvedFieldSegment {
  return (
    typeof value === 'object' &&
    value !== null &&
    ((value as {kind?: unknown}).kind === 'literal' ||
      (value as {kind?: unknown}).kind === 'deferred')
  );
}

function collectExpressionReferences(
  expression: WorkflowExpression | string,
  scope: Scope,
  source: FieldSource,
): void {
  const expressionSource = typeof expression === 'string' ? expression : expression.source;
  for (const reference of analyzeContextKeyAccess(expression).references) {
    const base = {
      key: reference.key,
      field: source.field,
      source: expressionSource,
      envKey: source.envKey,
      ...scope.location,
    };
    if (reference.root === 'vars') {
      scope.out.variables.push(base);
      continue;
    }
    const store = secretStoreOf(reference.store);
    if (store !== undefined) scope.out.secrets.push({...base, store});
  }
}

function secretStoreOf(store: string | undefined): ReferencedSecret['store'] | undefined {
  if (store === undefined || store === 'local') return 'local';
  if (store === 'inputs') return 'inputs';
  return undefined;
}
