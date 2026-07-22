import type {BadgeVariant} from '@shipfox/react-ui/badge';
import {getTriggerEventResult, type TriggerEventSummary} from '#core/trigger-event.js';

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
  event: Pick<TriggerEventSummary, 'outcome' | 'matchedCount'>,
): TriggerEventResult {
  const result = getTriggerEventResult(event);
  switch (result.kind) {
    case 'triggered': {
      const plural = result.matchedWorkflowCount === 1 ? '' : 's';
      return {
        label: `Triggered ${result.matchedWorkflowCount} workflow${plural}`,
        badge: 'info',
        isFailure: false,
      };
    }
    case 'no-match':
      return {label: 'No workflows triggered', badge: 'neutral', isFailure: false};
    case 'failed':
      return {label: 'Failed', badge: 'error', isFailure: true};
    case 'evaluating':
      return {label: 'Evaluating…', badge: 'neutral', isFailure: false};
  }
}
