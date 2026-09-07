import {
  analyzeHistoricalEventPayloadAccess,
  type HistoricalEventPayloadAccess,
  type ResolvedFieldSegment,
  type WorkflowExpression,
} from '@shipfox/expression';
import type {
  WorkflowFieldTemplate,
  WorkflowModel,
  WorkflowModelJob,
  WorkflowModelStep,
} from '../entities/workflow-model.js';
import type {
  WorkflowModelValidationIssue,
  WorkflowModelValidationIssuePathSegment,
} from './invalid-workflow-model-error.js';
import {issue} from './validation-issue.js';

export const HISTORICAL_EVENT_PAYLOAD_DEPENDENCY_CODE =
  'historical-event-payload-dependency' as const;

const celIdentifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const HISTORICAL_DEPENDENCY_MESSAGE_EXPRESSION_MAX_LENGTH = 160;

export type HistoricalEventPayloadDependencyClassification = 'safe' | 'payload' | 'unknown';

type Path = readonly WorkflowModelValidationIssuePathSegment[];

export interface HistoricalEventPayloadDependency {
  readonly path: Path;
  readonly expression: string;
  readonly access: HistoricalEventPayloadAccess;
}

export interface WorkflowModelHistoricalEventPayloadAudit {
  readonly classification: HistoricalEventPayloadDependencyClassification;
  readonly dependencies: readonly HistoricalEventPayloadDependency[];
}

export interface StoredWorkflowDefinitionHistoricalEventPayloadAudit {
  readonly totalDefinitions: number;
  readonly safeDefinitions: number;
  readonly payloadDefinitions: number;
  readonly unknownDefinitions: number;
}

/**
 * Finds historical event-payload dependencies in every expression-bearing
 * field that is retained by a normalized definition model. Deferred field
 * segments are included because they are the persisted plans later used by
 * execution materialization.
 */
export function findHistoricalEventPayloadDependencies(
  model: WorkflowModel,
): HistoricalEventPayloadDependency[] {
  const dependencies: HistoricalEventPayloadDependency[] = [];

  scanTemplate(model.runName, ['run_name'], dependencies);
  scanTemplateRecord(model.templates?.env, ['env'], dependencies);

  for (const [triggerIndex, trigger] of model.triggers.entries()) {
    scanExpressionSource(trigger.filter, ['triggers', trigger.key, 'filter'], dependencies);
    // Keep the index in the traversal for malformed legacy models where the
    // normalized trigger key is missing or duplicated.
    if (trigger.key === '') {
      scanExpressionSource(trigger.filter, ['triggers', triggerIndex, 'filter'], dependencies);
    }
  }

  for (const [jobIndex, job] of model.jobs.entries()) {
    const jobPath = ['jobs', job.key] as const;
    scanExpression(job.if, [...jobPath, 'if'], dependencies);
    scanExpressionSource(job.success, [...jobPath, 'success'], dependencies);
    scanTemplate(job.executionName, [...jobPath, 'execution_name'], dependencies);
    scanTemplateRecord(job.outputs, [...jobPath, 'outputs'], dependencies);
    scanTemplateRecord(job.templates?.env, [...jobPath, 'env'], dependencies);
    for (const template of job.runnerTemplates ?? []) {
      scanTemplate(template, [...jobPath, 'runner'], dependencies);
    }

    scanListeningExpressions(job, jobPath, dependencies);

    for (const [stepIndex, step] of job.steps.entries()) {
      scanWorkflowStep(step, [...jobPath, 'steps', stepIndex], dependencies);
    }

    // A future or malformed stored model can omit a job key. Keep its findings
    // auditable rather than dropping them into a safe bucket.
    if (job.key === '') {
      scanExpression(job.if, ['jobs', jobIndex, 'if'], dependencies);
    }
  }

  return deduplicateDependencies(dependencies);
}

export function auditWorkflowModelHistoricalEventPayloadDependencies(
  model: WorkflowModel,
): WorkflowModelHistoricalEventPayloadAudit {
  const dependencies = findHistoricalEventPayloadDependencies(model);
  const hasUnknown = dependencies.some((dependency) => dependency.access.kind === 'unknown');
  const hasPayload = dependencies.some((dependency) => dependency.access.kind === 'payload');
  let classification: HistoricalEventPayloadDependencyClassification = 'safe';
  if (hasUnknown) {
    classification = 'unknown';
  } else if (hasPayload) {
    classification = 'payload';
  }

  return {classification, dependencies};
}

export function auditStoredWorkflowDefinitionModels(
  models: readonly WorkflowModel[],
): StoredWorkflowDefinitionHistoricalEventPayloadAudit {
  let safeDefinitions = 0;
  let payloadDefinitions = 0;
  let unknownDefinitions = 0;

  for (const model of models) {
    let classification: HistoricalEventPayloadDependencyClassification;
    try {
      classification = auditWorkflowModelHistoricalEventPayloadDependencies(model).classification;
    } catch {
      classification = 'unknown';
    }

    switch (classification) {
      case 'safe':
        safeDefinitions += 1;
        break;
      case 'payload':
        payloadDefinitions += 1;
        break;
      case 'unknown':
        unknownDefinitions += 1;
        break;
    }
  }

  return {
    totalDefinitions: models.length,
    safeDefinitions,
    payloadDefinitions,
    unknownDefinitions,
  };
}

export function historicalEventPayloadDependencyIssues(
  model: WorkflowModel,
): WorkflowModelValidationIssue[] {
  const dependencies = new Map<string, HistoricalEventPayloadDependency>();
  for (const dependency of findHistoricalEventPayloadDependencies(model)) {
    const key = JSON.stringify([dependency.path, dependency.expression]);
    const previous = dependencies.get(key);
    if (
      previous === undefined ||
      (previous.access.kind === 'payload' && dependency.access.kind === 'unknown') ||
      (previous.access.kind === dependency.access.kind &&
        (dependency.access.segments?.length ?? 0) > (previous.access.segments?.length ?? 0))
    ) {
      dependencies.set(key, dependency);
    }
  }

  return [...dependencies.values()].map((dependency) => {
    const contextPath = formatHistoricalContextPath(dependency.access);
    const remediation =
      'Use current execution.events for payload data, or migrate this expression to prior-event metadata before historical payloads become unavailable.';
    const dynamic = dependency.access.kind === 'unknown';
    const expressionForMessage = shortenHistoricalDependencyExpression(dependency.expression);
    const referenceDescription = dynamic
      ? `may reach a prior execution event payload through dynamic access in ${expressionForMessage}`
      : `references the prior execution event payload at ${contextPath}`;

    return issue({
      code: HISTORICAL_EVENT_PAYLOAD_DEPENDENCY_CODE,
      message: `This expression ${referenceDescription}. ${remediation}`,
      path: dependency.path,
      details: {
        expression: dependency.expression,
        contextPath,
        classification: dependency.access.kind,
        remediation,
      },
      severity: 'warning',
    });
  });
}

function scanWorkflowStep(
  step: WorkflowModelStep,
  path: readonly (string | number)[],
  dependencies: HistoricalEventPayloadDependency[],
): void {
  scanExpression(step.if, [...path, 'if'], dependencies);
  scanTemplateRecord(step.templates, path, dependencies);

  if (step.gate?.success !== undefined) {
    scanExpression(step.gate.success, [...path, 'gate', 'success'], dependencies);
  }
  scanTemplate(
    step.gate?.onFailure?.feedbackTemplate,
    [...path, 'gate', 'on_failure', 'feedback'],
    dependencies,
  );

  if (step.kind === 'agent' && step.session !== undefined) {
    scanTemplate(step.session.key, [...path, 'session'], dependencies);
  }

  if (step.kind === 'checkout') {
    for (const [key, template] of Object.entries(step.checkout.templates ?? {})) {
      scanTemplate(template, [...path, 'checkout', key], dependencies);
    }
  }

  if (step.kind === 'tool') {
    for (const [key, expression] of Object.entries(step.outputMappings ?? {})) {
      scanExpression(expression, [...path, 'outputs', key], dependencies);
    }
    scanTemplateTree(step.templates?.with, [...path, 'with'], dependencies);
  }
}

function scanListeningExpressions(
  job: WorkflowModelJob,
  jobPath: readonly (string | number)[],
  dependencies: HistoricalEventPayloadDependency[],
): void {
  const listening = job.listening;
  if (listening === undefined) return;

  for (const [index, matcher] of listening.on.entries()) {
    scanExpressionSource(
      matcher.filter,
      [...jobPath, 'listening', 'on', index, 'filter'],
      dependencies,
    );
  }
  for (const [index, matcher] of (listening.until ?? []).entries()) {
    scanExpressionSource(
      matcher.filter,
      [...jobPath, 'listening', 'until', index, 'filter'],
      dependencies,
    );
  }
}

function scanTemplateRecord(
  value: Readonly<Record<string, unknown>> | undefined,
  path: readonly (string | number)[],
  dependencies: HistoricalEventPayloadDependency[],
): void {
  if (value === undefined) return;
  for (const [key, child] of Object.entries(value)) {
    scanTemplateTree(child, [...path, key], dependencies);
  }
}

function scanTemplate(
  template: WorkflowFieldTemplate | undefined,
  path: readonly (string | number)[],
  dependencies: HistoricalEventPayloadDependency[],
): void {
  scanTemplateTree(template, path, dependencies);
}

function scanTemplateTree(
  value: unknown,
  path: readonly (string | number)[],
  dependencies: HistoricalEventPayloadDependency[],
): void {
  if (value === undefined || value === null) return;
  if (isDeferredSegment(value)) {
    scanExpression(value.expression, path, dependencies);
    return;
  }
  if (isWorkflowExpression(value)) {
    scanExpression(value, path, dependencies);
    return;
  }
  if (Array.isArray(value)) {
    for (const child of value) scanTemplateTree(child, path, dependencies);
    return;
  }
  if (typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    scanTemplateTree(child, [...path, key], dependencies);
  }
}

function shortenHistoricalDependencyExpression(expression: string): string {
  if (expression.length <= HISTORICAL_DEPENDENCY_MESSAGE_EXPRESSION_MAX_LENGTH) {
    return expression;
  }

  return `${expression.slice(0, HISTORICAL_DEPENDENCY_MESSAGE_EXPRESSION_MAX_LENGTH - 1)}…`;
}

function scanExpression(
  expression: WorkflowExpression | undefined,
  path: readonly (string | number)[],
  dependencies: HistoricalEventPayloadDependency[],
): void {
  if (expression === undefined) return;
  scanExpressionSource(expression.source, path, dependencies);
}

function scanExpressionSource(
  source: string | undefined,
  path: readonly (string | number)[],
  dependencies: HistoricalEventPayloadDependency[],
): void {
  if (source === undefined || source.length === 0) return;

  try {
    for (const access of analyzeHistoricalEventPayloadAccess(source).accesses) {
      dependencies.push({path, expression: source, access});
    }
  } catch {
    // Stored models can outlive the parser version that created them. An
    // unreadable expression is unknown, never evidence that the definition is
    // safe to migrate to the metadata-only contract.
    dependencies.push({
      path,
      expression: source,
      access: {kind: 'unknown', root: 'executions', source, reason: 'dynamic'},
    });
  }
}

function isWorkflowExpression(value: object): value is WorkflowExpression {
  const candidate = value as {language?: unknown; source?: unknown};
  return candidate.language === 'cel' && typeof candidate.source === 'string';
}

function isDeferredSegment(
  value: object,
): value is Extract<ResolvedFieldSegment, {kind: 'deferred'}> {
  const candidate = value as {kind?: unknown; expression?: unknown};
  return (
    candidate.kind === 'deferred' &&
    candidate.expression !== null &&
    typeof candidate.expression === 'object' &&
    isWorkflowExpression(candidate.expression)
  );
}

function deduplicateDependencies(
  dependencies: readonly HistoricalEventPayloadDependency[],
): HistoricalEventPayloadDependency[] {
  const seen = new Set<string>();
  const result: HistoricalEventPayloadDependency[] = [];
  for (const dependency of dependencies) {
    const key = JSON.stringify([
      dependency.path,
      dependency.expression,
      dependency.access.kind,
      dependency.access.source,
      dependency.access.segments ?? null,
      dependency.access.reason,
    ]);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(dependency);
  }
  return result;
}

function formatHistoricalContextPath(access: HistoricalEventPayloadAccess): string {
  if (access.kind === 'unknown' || access.segments === undefined) {
    return 'executions[dynamic]';
  }

  let result = access.root;
  for (const segment of access.segments) {
    if (segment === '*') {
      result += '[*]';
    } else if (typeof segment === 'number') {
      result += `[${segment}]`;
    } else if (typeof segment === 'string' && celIdentifierPattern.test(segment)) {
      result += `.${segment}`;
    } else if (typeof segment === 'string') {
      result += `[${JSON.stringify(segment)}]`;
    } else {
      result += `[${JSON.stringify(segment.value)}]`;
    }
  }
  return result;
}
