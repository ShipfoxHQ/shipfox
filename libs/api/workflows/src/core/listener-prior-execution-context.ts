import type {WorkflowModel} from '@shipfox/api-definitions-dto';
import {
  analyzeContextPathAccess,
  type ContextPathAccessAnalysis,
  type ContextPathReference,
  type ResolvedFieldSegment,
  type WorkflowExpression,
} from '@shipfox/expression';

export interface ListenerPriorExecutionContextPlan {
  readonly includePriorExecutionEventMetadata: boolean;
  readonly referencesHistoricalExecutions: boolean;
  readonly historicalExecutionPaths: readonly ContextPathReference[];
  readonly hasDynamicHistoricalExecutionAccess: boolean;
}

/**
 * Plans listener context reads from persisted expressions. Historical event
 * bodies are never part of the plan; matching paths only opt into metadata.
 */
export function planListenerPriorExecutionContext(params: {
  readonly model: WorkflowModel | null;
  readonly jobKey: string;
  readonly success?: string | null | undefined;
}): ListenerPriorExecutionContextPlan {
  const job = params.model?.jobs.find((candidate) => candidate.key === params.jobKey);
  if (job === undefined) {
    return {
      includePriorExecutionEventMetadata: true,
      referencesHistoricalExecutions: true,
      historicalExecutionPaths: [],
      hasDynamicHistoricalExecutionAccess: true,
    };
  }

  const roots = new Set<string>();
  const historicalExecutionPaths: ContextPathReference[] = [];
  let hasDynamicHistoricalExecutionAccess = false;
  const pathPlan = {
    add(analysis: ContextPathAccessAnalysis) {
      historicalExecutionPaths.push(
        ...analysis.references.filter((reference) => reference.root === 'executions'),
      );
      hasDynamicHistoricalExecutionAccess ||= analysis.unknown.some(
        (access) => access.root === 'executions',
      );
    },
  };

  try {
    if (params.success !== undefined && params.success !== null) {
      addExpressionPlan(params.success, roots, pathPlan);
    }
    if (job.success !== undefined) addExpressionPlan(job.success, roots, pathPlan);
    collectExpressionRoots(params.model?.templates?.env, roots, new Set(), pathPlan);
    collectExpressionRoots(job, roots, new Set(), pathPlan);
  } catch {
    return {
      includePriorExecutionEventMetadata: true,
      referencesHistoricalExecutions: true,
      historicalExecutionPaths,
      hasDynamicHistoricalExecutionAccess: true,
    };
  }

  const referencesHistoricalExecutions = roots.has('executions');
  const includePriorExecutionEventMetadata =
    hasDynamicHistoricalExecutionAccess ||
    historicalExecutionPaths.some(historicalExecutionPathNeedsEventMetadata);
  return {
    includePriorExecutionEventMetadata,
    referencesHistoricalExecutions,
    historicalExecutionPaths,
    hasDynamicHistoricalExecutionAccess,
  };
}

export function listenerPriorExecutionEventsRequired(params: {
  readonly model: WorkflowModel | null;
  readonly jobKey: string;
  readonly success?: string | null | undefined;
}): boolean {
  return planListenerPriorExecutionContext(params).referencesHistoricalExecutions;
}

function historicalExecutionPathNeedsEventMetadata(reference: ContextPathReference): boolean {
  const referencesEventCollection = reference.segments.some(
    (segment) => segment === 'events' || segment === 'trigger_events',
  );
  if (reference.cardinalityOnly === true && !referencesEventCollection) return false;
  if (reference.wholeElement === true || reference.segments.length <= 1) return true;
  return referencesEventCollection;
}

interface ExpressionPathPlan {
  add(analysis: ContextPathAccessAnalysis): void;
}

function collectExpressionRoots(
  value: unknown,
  roots: Set<string>,
  visited: Set<object>,
  pathPlan: ExpressionPathPlan,
): void {
  if (value === null || typeof value !== 'object') return;
  if (isWorkflowExpression(value)) {
    addExpressionPlan(value.source, roots, pathPlan);
    return;
  }
  if (isDeferredSegment(value)) {
    for (const root of value.roots) roots.add(root);
    addExpressionPlan(value.expression.source, roots, pathPlan);
    return;
  }
  if (visited.has(value)) return;
  visited.add(value);

  if (Array.isArray(value)) {
    for (const child of value) collectExpressionRoots(child, roots, visited, pathPlan);
    return;
  }
  for (const child of Object.values(value)) {
    collectExpressionRoots(child, roots, visited, pathPlan);
  }
}

function addExpressionPlan(source: string, roots: Set<string>, pathPlan: ExpressionPathPlan): void {
  const analysis = analyzeContextPathAccess(source);
  for (const reference of analysis.references) roots.add(reference.root);
  for (const access of analysis.unknown) roots.add(access.root);
  pathPlan.add(analysis);
}

function isWorkflowExpression(value: object): value is WorkflowExpression {
  const candidate = value as {language?: unknown; source?: unknown};
  return candidate.language === 'cel' && typeof candidate.source === 'string';
}

function isDeferredSegment(
  value: object,
): value is Extract<ResolvedFieldSegment, {kind: 'deferred'}> {
  const candidate = value as {
    kind?: unknown;
    expression?: unknown;
    roots?: unknown;
  };
  return (
    candidate.kind === 'deferred' &&
    candidate.expression !== null &&
    typeof candidate.expression === 'object' &&
    Array.isArray(candidate.roots)
  );
}
