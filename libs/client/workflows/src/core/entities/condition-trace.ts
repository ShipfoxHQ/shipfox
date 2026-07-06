import type {EvaluationTraceRowEntryDto} from '@shipfox/api-workflows-dto';

export type NodeConditionLevel = 'job' | 'step';

// The distilled condition a job or step was gated on, derived from the node's
// server-side evaluation trace for rendering "skipped because <expression> was
// <value>". Attempt-level config traces are ignored; only the predicate that
// gated the node is summarized.
export interface NodeConditionSummary {
  // The evaluated predicate source, e.g. `steps.test.status == 'failed'` or the
  // platform's implicit default gate (`!execution.failed` / `needs.all(...)`).
  expression: string;
  // Stringified predicate result ('true' | 'false'), or null when the trace omits
  // it.
  value: string | null;
  // True when the node ran the implicit default gate rather than an authored `if:`.
  isDefaultGate: boolean;
  // True when the predicate fell closed on a broken expression (condition_errored).
  errored: boolean;
}

const CONDITION_FIELDS = {
  job: {explicit: 'job.if', defaultGate: 'job.default_gate'},
  step: {explicit: 'step.if', defaultGate: 'step.default_gate'},
} as const;

type EvaluationTraceFieldEntry = Extract<EvaluationTraceRowEntryDto, {field: string}>;

function isFieldEntry(entry: EvaluationTraceRowEntryDto): entry is EvaluationTraceFieldEntry {
  return 'field' in entry;
}

export function nodeConditionSummary(
  trace: readonly EvaluationTraceRowEntryDto[] | null,
  level: NodeConditionLevel,
): NodeConditionSummary | null {
  if (trace === null) return null;

  const fields = CONDITION_FIELDS[level];
  const entry = trace.find(
    (item) =>
      isFieldEntry(item) && (item.field === fields.explicit || item.field === fields.defaultGate),
  );
  if (entry === undefined || !isFieldEntry(entry)) return null;

  return {
    expression: entry.expression,
    value: entry.value ?? null,
    isDefaultGate: entry.field === fields.defaultGate,
    errored: entry.degraded === true,
  };
}
