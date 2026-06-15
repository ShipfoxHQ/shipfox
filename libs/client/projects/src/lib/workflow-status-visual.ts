import type {StatusDotVariant} from '#components/status-dot.js';

export type WorkflowStatusVisual = {
  badge: 'neutral' | 'info' | 'feature' | 'success' | 'warning' | 'error';
  dot: StatusDotVariant;
  label: string;
};

export function workflowStatusVisual(status: string): WorkflowStatusVisual {
  switch (status) {
    case 'succeeded':
      return {badge: 'success', dot: 'success', label: 'Succeeded'};
    case 'failed':
      return {badge: 'error', dot: 'error', label: 'Failed'};
    case 'running':
      return {badge: 'info', dot: 'info', label: 'Running'};
    case 'pending':
      return {badge: 'neutral', dot: 'neutral', label: 'Pending'};
    case 'waiting_for_dependencies':
      return {badge: 'neutral', dot: 'neutral', label: 'Waiting'};
    case 'cancelled':
      return {badge: 'neutral', dot: 'neutral', label: 'Cancelled'};
    case 'awaiting_manual':
      return {badge: 'feature', dot: 'warning', label: 'Awaiting manual'};
    default:
      return {badge: 'warning', dot: 'warning', label: `Unknown: ${status}`};
  }
}
