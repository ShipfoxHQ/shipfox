import type {JobStatusDto, RunStatusDto} from '@shipfox/api-workflows-dto';
import type {BadgeVariant, DotVariant, IconName} from '@shipfox/react-ui';

export type WorkflowStatus = JobStatusDto | RunStatusDto;

export interface WorkflowStatusVisual {
  kind: WorkflowStatus;
  label: string;
  dot: DotVariant;
  badge: BadgeVariant;
  icon: IconName;
}

export function getWorkflowStatusVisual(status: WorkflowStatus): WorkflowStatusVisual {
  switch (status) {
    case 'pending':
      return {
        kind: 'pending',
        label: 'Pending',
        dot: 'neutral',
        badge: 'neutral',
        icon: 'circleDottedLine',
      };
    case 'running':
      return {kind: 'running', label: 'Running', dot: 'info', badge: 'info', icon: 'spinner'};
    case 'succeeded':
      return {
        kind: 'succeeded',
        label: 'Succeeded',
        dot: 'success',
        badge: 'success',
        icon: 'check',
      };
    case 'failed':
      return {kind: 'failed', label: 'Failed', dot: 'error', badge: 'error', icon: 'close'};
    case 'cancelled':
      return {
        kind: 'cancelled',
        label: 'Cancelled',
        dot: 'neutral',
        badge: 'neutral',
        icon: 'close',
      };
  }

  const exhaustive: never = status;
  return exhaustive;
}
