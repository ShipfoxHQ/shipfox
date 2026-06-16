import type {BadgeVariant} from '@shipfox/react-ui';
import type {WorkflowDashboardStatus} from '../workflow-dashboard-types.js';

export function workflowStatusLabel(status: WorkflowDashboardStatus | string | undefined): string {
  if (!status) return '-';
  return (
    {
      'awaiting-runner': 'Awaiting runner',
      cancelled: 'Cancelled',
      failed: 'Failed',
      pending: 'Pending',
      queued: 'Queued',
      running: 'Running',
      succeeded: 'Succeeded',
      'timed-out': 'Timed out',
    }[status] ?? `${status[0]?.toUpperCase()}${status.slice(1)}`
  );
}

export function workflowStatusVariant(status: WorkflowDashboardStatus | string): BadgeVariant {
  if (status === 'succeeded') return 'success';
  if (status === 'failed' || status === 'timed-out') return 'error';
  if (status === 'running') return 'info';
  if (status === 'awaiting-runner') return 'warning';
  return 'neutral';
}

export function workflowStatusDotClass(status: WorkflowDashboardStatus | string): string {
  if (status === 'succeeded') return 'bg-tag-success-icon';
  if (status === 'failed' || status === 'timed-out') return 'bg-tag-error-icon';
  if (status === 'running') return 'bg-tag-blue-icon';
  if (status === 'awaiting-runner') return 'bg-tag-warning-icon';
  return 'bg-tag-neutral-icon';
}

export function workflowStatusBorderClass(status: WorkflowDashboardStatus | string): string {
  if (status === 'succeeded') return 'border-tag-success-border';
  if (status === 'failed' || status === 'timed-out') return 'border-tag-error-border';
  if (status === 'running') return 'border-tag-blue-border';
  if (status === 'awaiting-runner') return 'border-tag-warning-border';
  return 'border-border-neutral-base';
}

export function workflowStatusTextClass(status: WorkflowDashboardStatus | string): string {
  if (status === 'succeeded') return 'text-tag-success-text';
  if (status === 'failed' || status === 'timed-out') return 'text-tag-error-text';
  if (status === 'running') return 'text-tag-blue-text';
  if (status === 'awaiting-runner') return 'text-tag-warning-text';
  return 'text-foreground-neutral-muted';
}
