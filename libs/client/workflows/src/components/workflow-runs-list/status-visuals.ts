import type {RunStatusDto} from '@shipfox/api-workflows-dto';
import type {BadgeVariant, DotVariant, IconName} from '@shipfox/react-ui';

interface StatusVisual {
  label: string;
  dot: DotVariant;
  badge: BadgeVariant;
  icon: IconName;
}

const statusVisuals: Record<RunStatusDto, StatusVisual> = {
  pending: {label: 'Pending', dot: 'neutral', badge: 'neutral', icon: 'circleDottedLine'},
  running: {label: 'Running', dot: 'info', badge: 'info', icon: 'spinner'},
  succeeded: {label: 'Succeeded', dot: 'success', badge: 'success', icon: 'check'},
  failed: {label: 'Failed', dot: 'error', badge: 'error', icon: 'close'},
  cancelled: {label: 'Cancelled', dot: 'neutral', badge: 'neutral', icon: 'close'},
};

export function getStatusVisual(status: RunStatusDto): StatusVisual {
  return statusVisuals[status] ?? statusVisuals.pending;
}
