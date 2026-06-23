import type {TriggerEventOutcomeDto} from '@shipfox/api-triggers-dto';
import {Badge} from '@shipfox/react-ui';
import {getTriggerOutcomeVisual} from './trigger-outcome.js';

export function TriggerOutcomeBadge({outcome}: {outcome: TriggerEventOutcomeDto}) {
  const visual = getTriggerOutcomeVisual(outcome);
  return <Badge variant={visual.badge}>{visual.label}</Badge>;
}
