import type {TriggerEventListItemDto} from '@shipfox/api-triggers-dto';
import type {BadgeVariant} from '@shipfox/react-ui';

export interface TriggerEventResult {
  label: string;
  badge: BadgeVariant;
  isFailure: boolean;
}

/**
 * Collapses the raw event outcome into the single result an operator cares about:
 * how many workflows it triggered (or that it failed). `routed`/`discarded` are not
 * surfaced as distinct states - both are successfully-processed events that differ
 * only by match count.
 */
export function triggerEventResult(
  event: Pick<TriggerEventListItemDto, 'outcome' | 'matched_count'>,
): TriggerEventResult {
  switch (event.outcome) {
    case 'routed': {
      const plural = event.matched_count === 1 ? '' : 's';
      return {
        label: `Triggered ${event.matched_count} workflow${plural}`,
        badge: 'info',
        isFailure: false,
      };
    }
    case 'discarded':
      return {label: 'No workflows triggered', badge: 'neutral', isFailure: false};
    case 'failed':
    case 'errored':
      return {label: 'Failed', badge: 'error', isFailure: true};
    case 'received':
      return {label: 'Evaluating…', badge: 'neutral', isFailure: false};
    default: {
      const _exhaustive: never = event.outcome;
      return {label: 'Unknown', badge: 'warning', isFailure: false};
    }
  }
}
