import type {TriggerEventListItemDto} from '@shipfox/api-triggers-dto';

/**
 * One-line routing summary for an event row. List rows carry no per-decision detail, so
 * `failed`/`errored` show status text rather than a count — the dot already signals the
 * error and the decision breakdown lives in the detail view (ENG-552).
 */
export function triggerEventMatchSummary(
  event: Pick<TriggerEventListItemDto, 'outcome' | 'matched_count'>,
): string {
  switch (event.outcome) {
    case 'routed':
      return event.matched_count === 1 ? '→ 1 run' : `→ ${event.matched_count} runs`;
    case 'discarded':
      return 'No match';
    case 'failed':
    case 'errored':
      return 'Failed';
    default:
      return 'Evaluating…';
  }
}
