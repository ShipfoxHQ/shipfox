import type {AvailabilitySite, FillTarget} from '../workflow-context/workflow-context.js';
import type {RoutedExpression} from './route-expression.js';

export const EVALUATION_TRACE_VALUE_CAP_BYTES = 1024;
export const EVALUATION_TRACE_MAX_ENTRIES = 256;

const TRACE_TRUNCATION_MARKER = '...[truncated]';
const textEncoder = new TextEncoder();

export interface EvaluationTraceEntry {
  readonly expression: string;
  readonly roots: readonly string[];
  readonly fillTarget: FillTarget;
  readonly evaluatedAt: AvailabilitySite;
  readonly value?: string;
  readonly truncated?: boolean;
  readonly exprTruncated?: boolean;
  readonly reference?: boolean;
  readonly degraded?: boolean;
}

export interface EvaluationTraceLimitEntry {
  readonly truncated: true;
  readonly dropped: number;
}

export type EvaluationTraceRowEntry = EvaluationTraceEntry | EvaluationTraceLimitEntry;

export interface EvaluationTraceEntryInput {
  readonly expression: string;
  readonly roots: readonly string[];
  readonly fillTarget: FillTarget;
  readonly evaluatedAt: AvailabilitySite;
  readonly value?: string;
  readonly reference?: boolean;
  readonly degraded?: boolean;
}

export interface PredicateTraceEntryInput {
  readonly expression: string;
  readonly route: RoutedExpression;
  readonly site: AvailabilitySite;
  readonly value: boolean;
}

export function capTraceValue(value: string): {value: string; truncated: boolean} {
  if (textEncoder.encode(value).byteLength <= EVALUATION_TRACE_VALUE_CAP_BYTES) {
    return {value, truncated: false};
  }

  const budget =
    EVALUATION_TRACE_VALUE_CAP_BYTES - textEncoder.encode(TRACE_TRUNCATION_MARKER).byteLength;
  let used = 0;
  let capped = '';

  for (const char of value) {
    const charBytes = textEncoder.encode(char).byteLength;
    if (used + charBytes > budget) break;
    capped += char;
    used += charBytes;
  }

  return {value: capped + TRACE_TRUNCATION_MARKER, truncated: true};
}

export function evaluationTraceEntry(input: EvaluationTraceEntryInput): EvaluationTraceEntry {
  const expression = capTraceValue(input.expression);
  const value =
    input.value === undefined || input.reference === true ? undefined : capTraceValue(input.value);

  return {
    expression: expression.value,
    roots: input.roots,
    fillTarget: input.fillTarget,
    evaluatedAt: input.evaluatedAt,
    ...(value === undefined ? {} : {value: value.value}),
    ...(value?.truncated === true ? {truncated: true} : {}),
    ...(expression.truncated ? {exprTruncated: true} : {}),
    ...(input.reference === true ? {reference: true} : {}),
    ...(input.degraded === true ? {degraded: true} : {}),
  };
}

export function predicateTraceEntry(input: PredicateTraceEntryInput): EvaluationTraceEntry {
  return evaluationTraceEntry({
    expression: input.expression,
    roots: input.route.roots,
    fillTarget: input.route.fillTarget,
    evaluatedAt: input.site,
    value: String(input.value),
  });
}

export function capTraceEntries<Entry extends EvaluationTraceRowEntry>(
  entries: readonly Entry[],
): readonly (Exclude<Entry, EvaluationTraceLimitEntry> | EvaluationTraceLimitEntry)[] {
  const traceEntries: Exclude<Entry, EvaluationTraceLimitEntry>[] = [];
  let dropped = 0;

  for (const entry of entries) {
    if (isEvaluationTraceLimitEntry(entry)) {
      dropped += entry.dropped;
      continue;
    }

    traceEntries.push(entry as Exclude<Entry, EvaluationTraceLimitEntry>);
  }

  const keepCount = EVALUATION_TRACE_MAX_ENTRIES - 1;
  if (traceEntries.length + (dropped > 0 ? 1 : 0) <= EVALUATION_TRACE_MAX_ENTRIES) {
    return dropped === 0 ? traceEntries : [...traceEntries, {truncated: true, dropped}];
  }

  return [
    ...traceEntries.slice(0, keepCount),
    {truncated: true, dropped: dropped + traceEntries.length - keepCount},
  ];
}

function isEvaluationTraceLimitEntry(
  entry: EvaluationTraceRowEntry,
): entry is EvaluationTraceLimitEntry {
  return 'dropped' in entry;
}
