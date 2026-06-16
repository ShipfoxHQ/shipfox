import {Badge, cn} from '@shipfox/react-ui';
import {
  workflowStatusDotClass,
  workflowStatusLabel,
  workflowStatusVariant,
} from '../lib/workflow-dashboard-status.js';
import type {WorkflowDashboardStatus} from '../workflow-dashboard-types.js';

export function WorkflowStatusBadge({
  size = '2xs',
  status,
}: {
  size?: '2xs' | 'xs';
  status: WorkflowDashboardStatus;
}) {
  return (
    <Badge variant={workflowStatusVariant(status)} size={size} className="gap-5">
      <StatusDot status={status} size={size === 'xs' ? 'md' : 'sm'} />
      {workflowStatusLabel(status)}
    </Badge>
  );
}

export function StatusDot({
  pulse,
  size = 'md',
  status,
}: {
  pulse?: boolean;
  size?: 'sm' | 'md';
  status: WorkflowDashboardStatus;
}) {
  const shouldPulse = pulse && status === 'running';
  return (
    <span
      className={cn(
        'relative inline-block shrink-0 rounded-full',
        size === 'sm' ? 'size-6' : 'size-8',
        workflowStatusDotClass(status),
        shouldPulse &&
          'after:absolute after:inset-[-4px] after:rounded-full after:border-2 after:border-tag-blue-icon after:opacity-50 after:content-[""]',
      )}
    />
  );
}
