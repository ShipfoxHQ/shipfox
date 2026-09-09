import {analyzeContextPathAccess} from '@shipfox/expression';
import type {
  WorkflowFieldTemplate,
  WorkflowModelConcurrency,
  WorkflowModelJob,
} from '../entities/workflow-model.js';
import type {WorkflowModelValidationIssue} from './invalid-workflow-model-error.js';
import {parseInterpolationField} from './parse-interpolation-field.js';
import {issue} from './validation-issue.js';

const concurrencyGroupRoots = new Set(['workflow', 'trigger', 'event', 'inputs', 'vars']);

type DeclaredTrigger = {
  readonly source: string;
  readonly with?: Readonly<Record<string, unknown>> | undefined;
};

type ReferencedInputKeys = {
  readonly keys: readonly string[];
  readonly hasUnknownAccess: boolean;
};

export interface WorkflowModelConcurrencyInput {
  readonly group: string;
  readonly scope?: 'workflow' | 'project' | undefined;
  readonly cancel_in_progress?: boolean | undefined;
}

export function normalizeWorkflowConcurrency(params: {
  readonly concurrency: WorkflowModelConcurrencyInput | undefined;
  readonly jobs: readonly WorkflowModelJob[];
  readonly declaredTriggers: Readonly<Record<string, DeclaredTrigger>> | undefined;
  readonly issues: WorkflowModelValidationIssue[];
}): WorkflowModelConcurrency | undefined {
  const concurrency = params.concurrency;
  if (concurrency === undefined) return undefined;

  const group = normalizeGroup(concurrency.group, params.issues);
  const scope = normalizeScope(concurrency.scope, params.issues);
  const cancelInProgress = normalizeCancelInProgress(concurrency.cancel_in_progress, params.issues);
  const listeningJobs = params.jobs.filter((job) => job.mode === 'listening').map((job) => job.key);

  if (listeningJobs.length > 0) {
    params.issues.push(
      issue({
        code: 'concurrency-listening-job-unsupported',
        message: `Workflow concurrency cannot be used with listening jobs: ${formatList(listeningJobs)}.`,
        path: ['concurrency'],
        details: {jobs: listeningJobs},
      }),
    );
  }

  if (group === undefined) return undefined;

  warnForNullableRoots({
    group,
    declaredTriggers: params.declaredTriggers,
    issues: params.issues,
  });

  return {group, scope, cancelInProgress};
}

function normalizeGroup(
  source: unknown,
  issues: WorkflowModelValidationIssue[],
): WorkflowFieldTemplate | undefined {
  const path = ['concurrency', 'group'] as const;
  if (typeof source !== 'string' || source.length === 0) {
    issues.push(
      issue({
        code: 'invalid-concurrency-group',
        message: 'Concurrency group must be a non-empty string interpolation template.',
        path,
        details: {source},
      }),
    );
    return undefined;
  }

  const template = parseInterpolationField({
    field: 'workflow.run_name',
    source,
    path,
    issues,
  });
  if (template === undefined) {
    return [{kind: 'literal', value: source}];
  }

  const unsupportedRoots = referencedRoots(template).filter(
    (root) => !concurrencyGroupRoots.has(root),
  );
  if (unsupportedRoots.length > 0) {
    issues.push(
      issue({
        code: 'invalid-concurrency-group',
        message: `Concurrency group may reference only workflow, trigger, event, inputs, and vars contexts; found ${formatList(unsupportedRoots)}.`,
        path,
        details: {source, unsupportedRoots},
      }),
    );
    return undefined;
  }

  return template;
}

function normalizeScope(
  source: unknown,
  issues: WorkflowModelValidationIssue[],
): 'workflow' | 'project' {
  if (source === undefined) return 'workflow';
  if (source === 'workflow' || source === 'project') return source;

  issues.push(
    issue({
      code: 'invalid-concurrency-scope',
      message: 'Concurrency scope must be either "workflow" or "project".',
      path: ['concurrency', 'scope'],
      details: {source},
    }),
  );
  return 'workflow';
}

function normalizeCancelInProgress(
  source: unknown,
  issues: WorkflowModelValidationIssue[],
): boolean {
  if (source === undefined) return false;
  if (typeof source === 'boolean') return source;

  issues.push(
    issue({
      code: 'invalid-concurrency-cancel-in-progress',
      message: 'Concurrency cancel_in_progress must be a literal boolean.',
      path: ['concurrency', 'cancel_in_progress'],
      details: {source},
    }),
  );
  return false;
}

function warnForNullableRoots(params: {
  readonly group: WorkflowFieldTemplate;
  readonly declaredTriggers: Readonly<Record<string, DeclaredTrigger>> | undefined;
  readonly issues: WorkflowModelValidationIssue[];
}): void {
  if (params.declaredTriggers === undefined) return;

  const roots = referencedRoots(params.group);
  const inputKeys = referencedInputKeys(params.group);
  const nullableByTrigger = Object.entries(params.declaredTriggers).flatMap(([key, trigger]) => {
    const nullableRoots = roots.filter((root) => rootCanBeNullForTrigger(root, trigger, inputKeys));
    return nullableRoots.length === 0 ? [] : [{key, roots: nullableRoots}];
  });
  if (nullableByTrigger.length === 0) return;

  const nullableRoots = unique(nullableByTrigger.flatMap((entry) => entry.roots)) as readonly (
    | 'event'
    | 'inputs'
  )[];
  const triggerKeys = nullableByTrigger.map((entry) => entry.key);
  params.issues.push(
    issue({
      code: 'concurrency-group-root-may-be-null',
      message: `Concurrency group references ${formatList(nullableRoots)} that can be null for triggers ${formatList(triggerKeys)}. Use inputs available to every trigger or split triggers into separate definitions.`,
      path: ['concurrency', 'group'],
      severity: 'warning',
      details: {roots: nullableRoots, triggers: triggerKeys},
    }),
  );
}

function rootCanBeNullForTrigger(
  root: string,
  trigger: DeclaredTrigger,
  inputKeys: ReferencedInputKeys,
): boolean {
  if (root === 'event') return trigger.source === 'manual' || trigger.source === 'cron';
  if (root !== 'inputs') return false;
  if (trigger.source === 'manual') return true;
  if (inputKeys.hasUnknownAccess) return true;
  if (inputKeys.keys.length === 0) return trigger.with === undefined;
  return inputKeys.keys.some(
    (key) =>
      trigger.with === undefined ||
      !Object.hasOwn(trigger.with, key) ||
      trigger.with[key] === null ||
      trigger.with[key] === undefined,
  );
}

function referencedRoots(template: WorkflowFieldTemplate): readonly string[] {
  return unique(template.flatMap((segment) => (segment.kind === 'deferred' ? segment.roots : [])));
}

function referencedInputKeys(template: WorkflowFieldTemplate): ReferencedInputKeys {
  const keys: string[] = [];
  let hasUnknownAccess = false;

  for (const segment of template) {
    if (segment.kind !== 'deferred' || !segment.roots.includes('inputs')) continue;

    const access = analyzeContextPathAccess(segment.expression, ['inputs']);
    for (const reference of access.references) {
      const key = reference.segments[0];
      if (typeof key === 'string') {
        keys.push(key);
      } else if (typeof key === 'object' && key.kind === 'literal') {
        keys.push(key.value);
      } else {
        hasUnknownAccess = true;
      }
    }
    hasUnknownAccess ||= access.unknown.some((unknown) => unknown.root === 'inputs');
  }

  return {keys: unique(keys), hasUnknownAccess};
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function formatList(values: readonly string[]): string {
  return values.map((value) => `"${value}"`).join(', ');
}
