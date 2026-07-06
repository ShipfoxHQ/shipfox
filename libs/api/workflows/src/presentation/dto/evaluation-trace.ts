import type {EvaluationTraceRowEntryDto} from '@shipfox/api-workflows-dto';
import type {PersistedEvaluationTraceEntry} from '#core/entities/step.js';

// Maps a node's persisted evaluation trace to its DTO, normalizing the camelCase
// jsonb keys to snake_case. On the skip surfaces this serves (the job and step
// projection rows), the trace only carries condition predicates, which may not
// reference `secrets` (enforced at authoring), so no ephemeral value can leak here.
export function toEvaluationTraceDto(
  trace: readonly PersistedEvaluationTraceEntry[] | null | undefined,
): EvaluationTraceRowEntryDto[] | null {
  if (trace == null) return null;
  return trace.map(toEvaluationTraceEntryDto);
}

function toEvaluationTraceEntryDto(
  entry: PersistedEvaluationTraceEntry,
): EvaluationTraceRowEntryDto {
  if ('dropped' in entry) {
    return {truncated: true, dropped: entry.dropped};
  }
  return {
    field: entry.field,
    expression: entry.expression,
    roots: [...entry.roots],
    fill_target: entry.fillTarget,
    evaluated_at: entry.evaluatedAt,
    ...(entry.value === undefined ? {} : {value: entry.value}),
    ...(entry.truncated === true ? {truncated: true} : {}),
    ...(entry.exprTruncated === true ? {expr_truncated: true} : {}),
    ...(entry.reference === true ? {reference: true} : {}),
    ...(entry.degraded === true ? {degraded: true} : {}),
    ...(entry.envKey === undefined ? {} : {env_key: entry.envKey}),
  };
}
