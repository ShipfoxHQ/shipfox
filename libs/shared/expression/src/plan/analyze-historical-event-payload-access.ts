import type {WorkflowExpression} from '../expression/workflow-expression.js';
import {
  analyzeContextPathAccessForHistoricalPayload,
  type ContextPathAccessUnknown,
  type ContextPathReference,
  type ContextPathSegment,
} from './extract-context-paths.js';

/** A known or conservatively unknown dependency on a prior event payload. */
export type HistoricalEventPayloadAccessKind = 'payload' | 'unknown';

export interface HistoricalEventPayloadAccess {
  readonly kind: HistoricalEventPayloadAccessKind;
  readonly root: 'executions';
  readonly source: string;
  readonly segments?: readonly ContextPathSegment[];
  readonly reason?: 'dynamic';
}

export interface HistoricalEventPayloadAccessAnalysis {
  readonly accesses: readonly HistoricalEventPayloadAccess[];
}

const executionEventCollections = new Set(['events', 'trigger_events']);

/**
 * Classifies references that can require payload bodies from prior executions.
 *
 * `execution.events` is the current execution contract and is intentionally not
 * selected here. The path extractor remains the authority for CEL traversal,
 * including indexed and comprehension-based access; this layer only assigns
 * the historical payload meaning to those exact paths.
 */
export function analyzeHistoricalEventPayloadAccess(
  expression: WorkflowExpression | string,
): HistoricalEventPayloadAccessAnalysis {
  const analysis = analyzeContextPathAccessForHistoricalPayload(expression, ['executions']);
  const accesses = [
    ...analysis.references.flatMap(historicalPayloadAccessFromReference),
    ...analysis.unknown.map(historicalPayloadAccessFromUnknown),
  ];

  return {accesses: deduplicateAccesses(accesses)};
}

function historicalPayloadAccessFromReference(
  reference: ContextPathReference,
): HistoricalEventPayloadAccess[] {
  if (reference.root !== 'executions') return [];
  if (reference.cardinalityOnly === true && isCardinalityOnlyCollectionReference(reference)) {
    return [];
  }
  if (reference.segments.length === 0) return [payloadAccess(reference)];

  const eventCollection = reference.segments[1];
  if (typeof eventCollection === 'string' && executionEventCollections.has(eventCollection)) {
    return historicalEventCollectionPayloadAccess(reference);
  }

  // Reading an entire historical execution can include its event array even
  // when the expression does not name that array explicitly.
  const referencesExecutionElement =
    reference.segments.length === 1 &&
    (reference.wholeElement === true || typeof reference.segments[0] === 'number');
  return referencesExecutionElement ? [payloadAccess(reference)] : [];
}

function isCardinalityOnlyCollectionReference(reference: ContextPathReference): boolean {
  if (reference.wholeElement === true) return false;
  if (reference.segments.length === 0) return true;

  const eventCollection = reference.segments[1];
  return (
    reference.segments.length === 2 &&
    typeof eventCollection === 'string' &&
    executionEventCollections.has(eventCollection)
  );
}

function historicalEventCollectionPayloadAccess(
  reference: ContextPathReference,
): HistoricalEventPayloadAccess[] {
  const eventElement = reference.segments[2];
  const payloadSegment = reference.segments[3];
  const isComprehensionReceiver = eventElement === '*';
  const reachesPayload =
    payloadSegment === 'data' ||
    (!isComprehensionReceiver && reference.segments.length === 3) ||
    (reference.segments.length === 2 && reference.wholeElement !== true) ||
    reference.wholeElement === true;

  return reachesPayload ? [payloadAccess(reference)] : [];
}

function payloadAccess(reference: ContextPathReference): HistoricalEventPayloadAccess {
  return {
    kind: 'payload',
    root: 'executions',
    source: reference.source,
    segments: reference.segments,
  };
}

function historicalPayloadAccessFromUnknown(
  access: ContextPathAccessUnknown,
): HistoricalEventPayloadAccess {
  return {
    kind: 'unknown',
    root: 'executions',
    source: access.source,
    reason: 'dynamic',
  };
}

function deduplicateAccesses(
  accesses: readonly HistoricalEventPayloadAccess[],
): HistoricalEventPayloadAccess[] {
  const seen = new Set<string>();
  const result: HistoricalEventPayloadAccess[] = [];
  for (const access of accesses) {
    const key = JSON.stringify([
      access.kind,
      access.source,
      access.reason,
      access.segments ?? null,
    ]);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(access);
  }
  return result;
}
