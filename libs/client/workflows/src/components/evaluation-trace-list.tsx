import {Badge} from '@shipfox/react-ui/badge';
import {PropertyList, PropertyRow} from '@shipfox/react-ui/inspector';
import type {EvaluationTraceEntry, EvaluationTraceValueEntry} from '#core/workflow-run.js';

/** One property row per evaluated field: the field, its value, and the expression that produced it. */
export function EvaluationTraceList({trace}: {trace: readonly EvaluationTraceEntry[]}) {
  const keyCounts = new Map<string, number>();
  return (
    <PropertyList>
      {trace.map((entry) => {
        const key = evaluationTraceKey(entry, keyCounts);
        return 'dropped' in entry ? (
          <PropertyRow key={key} label="Not recorded">
            {entry.dropped} more evaluation{entry.dropped === 1 ? '' : 's'}
          </PropertyRow>
        ) : (
          <PropertyRow
            key={key}
            label={entry.field}
            labelFont="code"
            meta={<EvaluationFlags entry={entry} />}
          >
            <EvaluationValue entry={entry} />
            <span className="block break-all text-foreground-neutral-muted">
              from {entry.expression}
            </span>
          </PropertyRow>
        );
      })}
    </PropertyList>
  );
}

export function EvaluationValue({entry}: {entry: EvaluationTraceValueEntry}) {
  if (entry.value === undefined || entry.value === '') {
    return <span className="text-tag-error-text">(empty)</span>;
  }
  return <>{entry.value}</>;
}

export function EvaluationFlags({entry}: {entry: EvaluationTraceValueEntry | undefined}) {
  if (!entry) return null;
  const truncated = entry.truncated || entry.exprTruncated;
  if (!entry.degraded && !truncated) return null;
  return (
    <>
      {entry.degraded ? (
        <Badge size="2xs" variant="error">
          degraded
        </Badge>
      ) : null}
      {truncated ? <Badge size="2xs">truncated</Badge> : null}
    </>
  );
}

function evaluationTraceKey(entry: EvaluationTraceEntry, keyCounts: Map<string, number>): string {
  const keyBase =
    'dropped' in entry
      ? `limit-${entry.dropped}`
      : `evaluation-${entry.field}-${entry.expression}-${entry.evaluatedAt}-${entry.fillTarget}`;
  const occurrence = keyCounts.get(keyBase) ?? 0;
  keyCounts.set(keyBase, occurrence + 1);
  return `${keyBase}-${occurrence}`;
}
