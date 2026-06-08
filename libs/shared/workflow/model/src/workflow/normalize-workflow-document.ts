import type {
  WorkflowDocument,
  WorkflowDocumentJob,
  WorkflowDocumentStep,
} from '@shipfox/workflow-document';
import {parseWorkflowExpression} from '../expression/parse-workflow-expression.js';
import type {WorkflowExpression} from '../expression/workflow-expression.js';
import type {
  NormalizeWorkflowDocumentResult,
  WorkflowIRDependency,
  WorkflowIRGate,
  WorkflowIRJob,
  WorkflowIRStep,
  WorkflowIRTrigger,
  WorkflowModelDiagnostic,
  WorkflowModelDiagnosticCode,
  WorkflowModelDiagnosticPathSegment,
} from './workflow-ir.js';

const nonStableIdPattern = /[^a-z0-9]+/g;
const edgeDashPattern = /^-+|-+$/g;
const manualTriggerSource = 'manual';

export function normalizeWorkflowDocument(
  document: WorkflowDocument,
): NormalizeWorkflowDocumentResult {
  const diagnostics: WorkflowModelDiagnostic[] = [];
  const jobIdBySourceName = new Map<string, string>();
  const usedJobIds = new Map<string, string>();

  for (const sourceName of Object.keys(document.jobs)) {
    const id = stableId(sourceName);
    const existingSourceName = usedJobIds.get(id);
    if (existingSourceName !== undefined) {
      diagnostics.push(
        diagnostic({
          code: 'WFM104',
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

  const triggers = normalizeTriggers(document, diagnostics);
  const jobs = normalizeJobs(document, jobIdBySourceName, diagnostics);
  const dependencies = normalizeDependencies(document.jobs, jobIdBySourceName, diagnostics);
  validateCycles(document.jobs, jobIdBySourceName, diagnostics);

  if (diagnostics.length > 0) {
    return {valid: false, diagnostics};
  }

  return {
    valid: true,
    ir: {
      kind: 'workflow',
      name: document.name,
      triggers,
      jobs,
      dependencies,
    },
    diagnostics: [],
  };
}

function normalizeTriggers(
  document: WorkflowDocument,
  diagnostics: WorkflowModelDiagnostic[],
): readonly WorkflowIRTrigger[] {
  const triggers = document.triggers ?? {};
  const manualTriggerNames = Object.entries(triggers)
    .filter(([, trigger]) => trigger.source === manualTriggerSource)
    .map(([sourceName]) => sourceName);
  const usedTriggerIds = new Map<string, string>();

  if (manualTriggerNames.length > 1) {
    diagnostics.push(
      diagnostic({
        code: 'WFM301',
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
      diagnostics.push(
        diagnostic({
          code: 'WFM105',
          message: `Trigger names "${existingSourceName}" and "${sourceName}" resolve to the same stable id "${id}".`,
          path: ['triggers', sourceName],
          details: {id, sourceNames: [existingSourceName, sourceName]},
        }),
      );
      return [];
    }
    usedTriggerIds.set(id, sourceName);

    const parsedFilter =
      trigger.filter === undefined ? undefined : parseWorkflowExpression(trigger.filter);

    if (parsedFilter?.valid === false) {
      diagnostics.push(
        diagnostic({
          code: 'WFM201',
          message: `Trigger "${sourceName}" has an invalid filter expression.`,
          path: ['triggers', sourceName, 'filter'],
          details: {expressionDiagnostics: parsedFilter.diagnostics},
        }),
      );
      return [];
    }

    if (parsedFilter !== undefined && expressionUsesRoot(parsedFilter.expression, 'step')) {
      diagnostics.push(
        diagnostic({
          code: 'WFM201',
          message: `Trigger "${sourceName}" has an invalid filter expression.`,
          path: ['triggers', sourceName, 'filter'],
          details: {unsupportedRoot: 'step', allowedRoots: ['event']},
        }),
      );
      return [];
    }

    return [
      {
        id,
        sourceName,
        source: trigger.source,
        event: trigger.event,
        ...(trigger.with === undefined ? {} : {inputs: trigger.with}),
        ...(parsedFilter === undefined
          ? {}
          : {filter: {source: parsedFilter.source, expression: parsedFilter.expression}}),
      },
    ];
  });
}

function normalizeJobs(
  document: WorkflowDocument,
  jobIdBySourceName: ReadonlyMap<string, string>,
  diagnostics: WorkflowModelDiagnostic[],
): readonly WorkflowIRJob[] {
  return Object.entries(document.jobs).flatMap(([sourceName, job]) => {
    const id = jobIdBySourceName.get(sourceName);
    if (id === undefined) return [];
    const usedStepIds = new Map<string, number>();

    const dependencies = normalizeNeeds(job.needs).flatMap((dependencySourceName) => {
      const dependencyId = jobIdBySourceName.get(dependencySourceName);
      if (dependencyId === undefined || dependencySourceName === sourceName) return [];
      return [dependencyId];
    });

    const steps = job.steps.map((step, index): WorkflowIRStep => {
      const stepSourceName = step.name;
      const stepId =
        stepSourceName === undefined
          ? `${id}-step-${index + 1}`
          : `${id}-${stableId(stepSourceName)}`;
      const existingIndex = usedStepIds.get(stepId);
      if (existingIndex !== undefined) {
        diagnostics.push(
          diagnostic({
            code: 'WFM106',
            message: `Steps ${existingIndex} and ${index} in job "${sourceName}" resolve to the same stable id "${stepId}".`,
            path: ['jobs', sourceName, 'steps', index],
            details: {id: stepId, indexes: [existingIndex, index]},
          }),
        );
      } else {
        usedStepIds.set(stepId, index);
      }

      const gate = normalizeGate({
        jobSourceName: sourceName,
        step,
        stepId,
        stepIndex: index,
        priorSteps: job.steps.slice(0, index),
        diagnostics,
      });

      if ('agent' in step) {
        return {
          id: stepId,
          ...(stepSourceName === undefined ? {} : {sourceName: stepSourceName}),
          kind: 'agent',
          agent: step.agent,
          prompt: step.prompt,
          ...(step.output_schema === undefined ? {} : {outputSchema: step.output_schema}),
          ...(step.session === undefined ? {} : {session: step.session}),
          ...(gate === undefined ? {} : {gate}),
        };
      }

      return {
        id: stepId,
        ...(stepSourceName === undefined ? {} : {sourceName: stepSourceName}),
        kind: 'run',
        command: {kind: 'shell', value: step.run},
        acceptance: {kind: 'default_run_exit_code'},
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

function normalizeGate(params: {
  jobSourceName: string;
  step: WorkflowDocumentStep;
  stepId: string;
  stepIndex: number;
  priorSteps: readonly WorkflowDocumentStep[];
  diagnostics: WorkflowModelDiagnostic[];
}): WorkflowIRGate | undefined {
  const gate = params.step.gate;
  if (gate === undefined) return undefined;

  const irGate: WorkflowIRGate = {};

  if (gate.success_if !== undefined) {
    const parsed = parseWorkflowExpression(gate.success_if);
    if (!parsed.valid) {
      params.diagnostics.push(
        diagnostic({
          code: 'WFM402',
          message: `Step "${params.stepId}" has an invalid gate success_if expression.`,
          path: ['jobs', params.jobSourceName, 'steps', params.stepIndex, 'gate', 'success_if'],
          details: {expressionDiagnostics: parsed.diagnostics},
        }),
      );
    } else {
      if (expressionUsesPath(parsed.expression, ['step', 'output'])) {
        if ('run' in params.step) {
          params.diagnostics.push(
            diagnostic({
              code: 'WFM403',
              message: `Step "${params.stepId}" cannot use step.output in gate success_if because run steps do not declare output_schema.`,
              path: ['jobs', params.jobSourceName, 'steps', params.stepIndex, 'gate', 'success_if'],
              details: {stepId: params.stepId},
            }),
          );
        }

        if ('agent' in params.step && params.step.output_schema === undefined) {
          params.diagnostics.push(
            diagnostic({
              code: 'WFM404',
              message: `Step "${params.stepId}" must declare output_schema before gate success_if can read step.output.`,
              path: ['jobs', params.jobSourceName, 'steps', params.stepIndex, 'output_schema'],
              details: {stepId: params.stepId},
            }),
          );
        }
      }

      irGate.successIf = {source: parsed.source, expression: parsed.expression};
    }
  }

  if (gate.on_failure !== undefined) {
    const restartFrom = gate.on_failure.restart_from;
    const allowedRestartTargets = params.priorSteps.flatMap((step) =>
      step.name === undefined ? [] : [step.name],
    );

    if (!allowedRestartTargets.includes(restartFrom)) {
      params.diagnostics.push(
        diagnostic({
          code: 'WFM401',
          message: `Step "${params.stepId}" gate.on_failure.restart_from must reference a named previous step in the same job.`,
          path: [
            'jobs',
            params.jobSourceName,
            'steps',
            params.stepIndex,
            'gate',
            'on_failure',
            'restart_from',
          ],
          details: {restartFrom, allowedRestartTargets},
        }),
      );
    }

    irGate.onFailure = {
      restartFrom,
      ...(gate.on_failure.output === undefined ? {} : {output: gate.on_failure.output}),
    };
  }

  return Object.keys(irGate).length === 0 ? undefined : irGate;
}

function expressionUsesRoot(expression: WorkflowExpression, root: 'event' | 'step'): boolean {
  if (expression.kind === 'ref') return expression.path[0] === root;
  if (expression.kind === 'unary') return expressionUsesRoot(expression.argument, root);
  if (expression.kind === 'binary') {
    return expressionUsesRoot(expression.left, root) || expressionUsesRoot(expression.right, root);
  }
  return false;
}

function expressionUsesPath(expression: WorkflowExpression, path: readonly string[]): boolean {
  if (expression.kind === 'ref') {
    return path.every((segment, index) => expression.path[index] === segment);
  }

  if (expression.kind === 'unary') return expressionUsesPath(expression.argument, path);
  if (expression.kind === 'binary') {
    return expressionUsesPath(expression.left, path) || expressionUsesPath(expression.right, path);
  }

  return false;
}

function normalizeDependencies(
  jobs: Readonly<Record<string, WorkflowDocumentJob>>,
  jobIdBySourceName: ReadonlyMap<string, string>,
  diagnostics: WorkflowModelDiagnostic[],
): readonly WorkflowIRDependency[] {
  const dependencies: WorkflowIRDependency[] = [];

  for (const [sourceName, job] of Object.entries(jobs)) {
    const to = jobIdBySourceName.get(sourceName);
    if (to === undefined) continue;

    for (const dependencySourceName of normalizeNeeds(job.needs)) {
      if (!jobIdBySourceName.has(dependencySourceName)) {
        diagnostics.push(
          diagnostic({
            code: 'WFM101',
            message: `Job "${sourceName}" depends on unknown job "${dependencySourceName}".`,
            path: ['jobs', sourceName, 'needs'],
            details: {job: sourceName, dependency: dependencySourceName},
          }),
        );
        continue;
      }

      if (dependencySourceName === sourceName) {
        diagnostics.push(
          diagnostic({
            code: 'WFM102',
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
  diagnostics: WorkflowModelDiagnostic[],
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
    diagnostics.push(
      diagnostic({
        code: 'WFM103',
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

function diagnostic(params: {
  code: WorkflowModelDiagnosticCode;
  message: string;
  path: readonly WorkflowModelDiagnosticPathSegment[];
  details?: Readonly<Record<string, unknown>>;
}): WorkflowModelDiagnostic {
  if (params.details === undefined) {
    return {
      code: params.code,
      severity: 'error',
      message: params.message,
      path: params.path,
    };
  }

  return {
    code: params.code,
    severity: 'error',
    message: params.message,
    path: params.path,
    details: params.details,
  };
}
