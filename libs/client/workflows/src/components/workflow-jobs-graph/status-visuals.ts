import type {JobStatusDto} from '@shipfox/api-workflows-dto';
import type {BadgeVariant, DotVariant, IconName} from '@shipfox/react-ui';

export type WorkflowJobStatusKind = JobStatusDto;

export interface JobStatusVisual {
  kind: WorkflowJobStatusKind;
  label: string;
  dot: DotVariant;
  badge: BadgeVariant;
  icon: IconName;
}

export function getJobStatusVisual(status: JobStatusDto): JobStatusVisual {
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
      return {
        kind: 'running',
        label: 'Running',
        dot: 'info',
        badge: 'info',
        icon: 'circleDottedLine',
      };
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
