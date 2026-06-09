import {
  createWorkflowExpression,
  InvalidWorkflowExpressionError,
  type WorkflowExpression,
} from '@shipfox/expression-language';
import type {
  WorkflowDocument,
  WorkflowDocumentJob,
  WorkflowDocumentRunStep,
} from '@shipfox/workflow-document';
import type {
  WorkflowModel,
  WorkflowModelDependency,
  WorkflowModelJob,
  WorkflowModelStep,
  WorkflowModelStepGate,
  WorkflowModelTrigger,
} from '../entities/workflow-model.js';
import {
  InvalidWorkflowModelError,
  type WorkflowModelValidationIssue,
  type WorkflowModelValidationIssueCode,
  type WorkflowModelValidationIssuePathSegment,
} from './invalid-workflow-model-error.js';

const nonStableIdPattern = /[^a-z0-9]+/g;
const edgeDashPattern = /^-+|-+$/g;
const manualTriggerSource = 'manual';

export function normalizeWorkflowDocument(document: WorkflowDocument): WorkflowModel {
  const issues: WorkflowModelValidationIssue[] = [];
  const jobIdBySourceName = mapJobIds(document, issues);
  const triggers = normalizeTriggers(document, issues);
  const jobs = normalizeJobs(document, jobIdBySourceName, issues);
  const dependencies = normalizeDependencies(document.jobs, jobIdBySourceName, issues);

  validateCycles(document.jobs, jobIdBySourceName, issues);

  if (issues.length > 0) {
    throw new InvalidWorkflowModelError(issues);
  }

  return {
    kind: 'workflow',
    name: document.name,
    triggers,
    jobs,
    dependencies,
  };
}

function mapJobIds(
  document: WorkflowDocument,
  issues: WorkflowModelValidationIssue[],
): ReadonlyMap<string, string> {
  const jobIdBySourceName = new Map<string, string>();
  const usedJobIds = new Map<string, string>();

  for (const sourceName of Object.keys(document.jobs)) {
    const id = stableId(sourceName);
    const existingSourceName = usedJobIds.get(id);
    if (existingSourceName !== undefined) {
      issues.push(
        issue({
          code: 'duplicate-job-id',
          message: `Job names "${existingSourceName}" and "${sourceName}" resolve to the same stable id "${id}".`,
          path: ['jobs', sourceName],
          details: {id, sourceNames: [existingSourceName, sourceName]},
        }),
      );
      continue;
    }

    usedJobIds.set(id, sourceName);
    jobIdBySourceName.set(sourceName, id);
  }

  return jobIdBySourceName;
}

function normalizeTriggers(
  document: WorkflowDocument,
  issues: WorkflowModelValidationIssue[],
): readonly WorkflowModelTrigger[] {
  const triggers = document.triggers ?? {};
  const manualTriggerNames = Object.entries(triggers)
    .filter(([, trigger]) => trigger.source === manualTriggerSource)
    .map(([sourceName]) => sourceName);
  const usedTriggerIds = new Map<string, string>();

  if (manualTriggerNames.length > 1) {
    issues.push(
      issue({
        code: 'multiple-manual-triggers',
        message: `A workflow may declare at most one manual trigger; found ${manualTriggerNames.length}: ${manualTriggerNames.join(', ')}.`,
        path: ['triggers'],
        details: {manualTriggerNames},
      }),
    );
  }

  return Object.entries(triggers).flatMap(([sourceName, trigger]) => {
    const id = stableId(sourceName);
    const existingSourceName = usedTriggerIds.get(id);
    if (existingSourceName !== undefined) {
      issues.push(
        issue({
          code: 'duplicate-trigger-id',
          message: `Trigger names "${existingSourceName}" and "${sourceName}" resolve to the same stable id "${id}".`,
          path: ['triggers', sourceName],
          details: {id, sourceNames: [existingSourceName, sourceName]},
        }),
      );
      return [];
    }
    usedTriggerIds.set(id, sourceName);

    return [
      {
        id,
        sourceName,
        source: trigger.source,
        event: trigger.event,
        ...(trigger.with === undefined ? {} : {inputs: trigger.with}),
        ...(trigger.filter === undefined ? {} : {filter: trigger.filter}),
      },
    ];
  });
}

function normalizeJobs(
  document: WorkflowDocument,
  jobIdBySourceName: ReadonlyMap<string, string>,
  issues: WorkflowModelValidationIssue[],
): readonly WorkflowModelJob[] {
  return Object.entries(document.jobs).flatMap(([sourceName, job]) => {
    const id = jobIdBySourceName.get(sourceName);
    if (id === undefined) return [];

    const usedStepIds = new Map<string, number>();
    const dependencies = normalizeNeeds(job.needs).flatMap((dependencySourceName) => {
      const dependencyId = jobIdBySourceName.get(dependencySourceName);
      if (dependencyId === undefined || dependencySourceName === sourceName) return [];
      return [dependencyId];
    });

    const steps = job.steps.map((step, index): WorkflowModelStep => {
      const stepSourceName = step.name;
      const stepId =
        stepSourceName === undefined
          ? `${id}-step-${index + 1}`
          : `${id}-${stableId(stepSourceName)}`;
      const existingIndex = usedStepIds.get(stepId);

      if (existingIndex !== undefined) {
        issues.push(
          issue({
            code: 'duplicate-step-id',
            message: `Steps ${existingIndex} and ${index} in job "${sourceName}" resolve to the same stable id "${stepId}".`,
            path: ['jobs', sourceName, 'steps', index],
            details: {id: stepId, indexes: [existingIndex, index]},
          }),
        );
      } else {
        usedStepIds.set(stepId, index);
      }

      const gate = normalizeStepGate({
        step,
        sourceName,
        stepIndex: index,
        stepId,
        previousStepSourceNames: new Set(
          job.steps
            .slice(0, index)
            .flatMap((candidate) => (candidate.name ? [candidate.name] : [])),
        ),
        issues,
      });

      return {
        id: stepId,
        ...(stepSourceName === undefined ? {} : {sourceName: stepSourceName}),
        kind: 'run',
        command: {kind: 'shell', value: step.run},
        ...(gate === undefined ? {} : {gate}),
      };
    });

    return [
      {
        id,
        sourceName,
        runner: normalizeStringArray(job.runner ?? document.runner),
        dependencies,
        steps,
      },
    ];
  });
}

function normalizeStepGate(params: {
  step: WorkflowDocumentRunStep;
  sourceName: string;
  stepIndex: number;
  stepId: string;
  previousStepSourceNames: ReadonlySet<string>;
  issues: WorkflowModelValidationIssue[];
}): WorkflowModelStepGate | undefined {
  const gate = params.step.gate;
  if (gate === undefined) return undefined;

  const successIf = normalizeGateSuccessIf({
    source: gate.success_if,
    sourceName: params.sourceName,
    stepIndex: params.stepIndex,
    issues: params.issues,
  });
  const onFailure =
    gate.on_failure === undefined
      ? undefined
      : {
          restartFrom: gate.on_failure.restart_from,
          ...(gate.on_failure.output === undefined ? {} : {output: gate.on_failure.output}),
        };

  if (
    gate.on_failure !== undefined &&
    !params.previousStepSourceNames.has(gate.on_failure.restart_from)
  ) {
    params.issues.push(
      issue({
        code: 'invalid-step-gate-restart-from',
        message: `Step "${params.stepId}" must restart from an earlier named step; found "${gate.on_failure.restart_from}".`,
        path: ['jobs', params.sourceName, 'steps', params.stepIndex, 'gate', 'on_failure'],
        details: {stepId: params.stepId, restartFrom: gate.on_failure.restart_from},
      }),
    );
  }

  if (successIf === undefined && onFailure === undefined) return undefined;

  return {
    ...(successIf === undefined ? {} : {successIf}),
    ...(onFailure === undefined ? {} : {onFailure}),
  };
}

function normalizeGateSuccessIf(params: {
  source: string | undefined;
  sourceName: string;
  stepIndex: number;
  issues: WorkflowModelValidationIssue[];
}): WorkflowExpression | undefined {
  if (params.source === undefined) return undefined;

  try {
    return createWorkflowExpression({
      source: params.source,
      typeEnvironment: {
        exit_code: 'int',
      },
    });
  } catch (error) {
    params.issues.push(
      issue({
        code: 'invalid-step-gate-success-if',
        message: 'Step gate success_if must be a valid CEL boolean expression.',
        path: ['jobs', params.sourceName, 'steps', params.stepIndex, 'gate', 'success_if'],
        details: {
          source: params.source,
          reason:
            error instanceof InvalidWorkflowExpressionError
              ? error.reason
              : 'Expression source did not parse or type-check.',
        },
      }),
    );
    return undefined;
  }
}

function normalizeDependencies(
  jobs: Readonly<Record<string, WorkflowDocumentJob>>,
  jobIdBySourceName: ReadonlyMap<string, string>,
  issues: WorkflowModelValidationIssue[],
): readonly WorkflowModelDependency[] {
  const dependencies: WorkflowModelDependency[] = [];

  for (const [sourceName, job] of Object.entries(jobs)) {
    const to = jobIdBySourceName.get(sourceName);
    if (to === undefined) continue;

    for (const dependencySourceName of normalizeNeeds(job.needs)) {
      if (!jobIdBySourceName.has(dependencySourceName)) {
        issues.push(
          issue({
            code: 'unknown-job-dependency',
            message: `Job "${sourceName}" depends on unknown job "${dependencySourceName}".`,
            path: ['jobs', sourceName, 'needs'],
            details: {job: sourceName, dependency: dependencySourceName},
          }),
        );
        continue;
      }

      if (dependencySourceName === sourceName) {
        issues.push(
          issue({
            code: 'self-job-dependency',
            message: `Job "${sourceName}" depends on itself.`,
            path: ['jobs', sourceName, 'needs'],
            details: {job: sourceName},
          }),
        );
        continue;
      }

      dependencies.push({from: jobIdBySourceName.get(dependencySourceName) as string, to});
    }
  }

  return dependencies;
}

function validateCycles(
  jobs: Readonly<Record<string, WorkflowDocumentJob>>,
  jobIdBySourceName: ReadonlyMap<string, string>,
  issues: WorkflowModelValidationIssue[],
): void {
  const jobNames = Object.keys(jobs);
  const adjacency = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const name of jobNames) {
    adjacency.set(name, []);
    inDegree.set(name, 0);
  }

  for (const [name, job] of Object.entries(jobs)) {
    for (const dependency of normalizeNeeds(job.needs)) {
      if (!jobIdBySourceName.has(dependency) || dependency === name) continue;

      adjacency.get(dependency)?.push(name);
      inDegree.set(name, (inDegree.get(name) ?? 0) + 1);
    }
  }

  const queue = jobNames.filter((name) => inDegree.get(name) === 0);
  const sorted: string[] = [];

  while (queue.length > 0) {
    const node = queue.shift() as string;
    sorted.push(node);

    for (const neighbor of adjacency.get(node) ?? []) {
      const nextDegree = (inDegree.get(neighbor) ?? 0) - 1;
      inDegree.set(neighbor, nextDegree);
      if (nextDegree === 0) queue.push(neighbor);
    }
  }

  if (sorted.length < jobNames.length) {
    const cycleSourceNames = jobNames.filter((name) => !sorted.includes(name));
    issues.push(
      issue({
        code: 'job-dependency-cycle',
        message: `Circular dependency detected among jobs: ${cycleSourceNames.join(', ')}.`,
        path: ['jobs'],
        details: {
          cycleSourceNames,
          cycleJobIds: cycleSourceNames.flatMap((name) => {
            const id = jobIdBySourceName.get(name);
            return id === undefined ? [] : [id];
          }),
        },
      }),
    );
  }
}

function normalizeNeeds(value: string | readonly string[] | undefined): readonly string[] {
  return uniqueStrings(normalizeStringArray(value));
}

function normalizeStringArray(value: string | readonly string[] | undefined): readonly string[] {
  if (value === undefined) return [];
  return typeof value === 'string' ? [value] : value;
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function stableId(sourceName: string): string {
  const id = sourceName
    .trim()
    .toLowerCase()
    .replace(nonStableIdPattern, '-')
    .replace(edgeDashPattern, '');

  return id.length === 0 ? 'unnamed' : id;
}

function issue(params: {
  code: WorkflowModelValidationIssueCode;
  message: string;
  path: readonly WorkflowModelValidationIssuePathSegment[];
  details?: Readonly<Record<string, unknown>>;
}): WorkflowModelValidationIssue {
  if (params.details === undefined) {
    return {
      code: params.code,
      message: params.message,
      path: params.path,
    };
  }

  return {
    code: params.code,
    message: params.message,
    path: params.path,
    details: params.details,
  };
}
