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

// `icon` is the self-contained circular glyph the standalone `WorkflowStatusIcon`
// renders (shape + the saturated `--tag-*-icon` tone). It also feeds the run-header
// pill. `running` carries a filled-circle fallback because `WorkflowStatusIcon`
// renders the live `Dot` (disc + ripple) for it instead of this glyph.
//
// When the API status enum grows to the DESIGN.md section-9 states, the exhaustive
// switch below turns each new value into a compile error. Reserve the warning tone
// (`dot`/`badge: 'warning'`) with an alert glyph for `queued`/`awaiting-runner`/
// `awaiting-manual` so they stay visually consistent.
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
      return {kind: 'running', label: 'Running', dot: 'info', badge: 'info', icon: 'circleFill'};
    case 'succeeded':
      return {
        kind: 'succeeded',
        label: 'Succeeded',
        dot: 'success',
        badge: 'success',
        icon: 'checkCircleSolid',
      };
    case 'failed':
      return {kind: 'failed', label: 'Failed', dot: 'error', badge: 'error', icon: 'xCircleSolid'};
    case 'cancelled':
      return {
        kind: 'cancelled',
        label: 'Cancelled',
        dot: 'neutral',
        badge: 'neutral',
        icon: 'forbid2Fill',
      };
  }

  const exhaustive: never = status;
  return exhaustive;
}
