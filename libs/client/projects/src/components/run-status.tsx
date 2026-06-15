import type {RunStatusDto} from '@shipfox/api-workflows-dto';
import {Text} from '@shipfox/react-ui';
import {StatusDot, type StatusDotVariant} from './status-dot.js';

export const TERMINAL_RUN_STATUSES = new Set<RunStatusDto>(['succeeded', 'failed', 'cancelled']);

export const runStatusVariant: Record<RunStatusDto, StatusDotVariant> = {
  pending: 'neutral',
  running: 'info',
  succeeded: 'success',
  failed: 'error',
  cancelled: 'neutral',
};

const labelByStatus: Record<RunStatusDto, string> = {
  pending: 'Pending',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const pillClassByStatus: Record<RunStatusDto, string> = {
  pending: 'bg-tag-neutral-bg text-tag-neutral-text border-tag-neutral-border',
  running: 'bg-tag-blue-bg text-tag-blue-text border-tag-blue-border',
  succeeded: 'bg-tag-success-bg text-tag-success-text border-tag-success-border',
  failed: 'bg-tag-error-bg text-tag-error-text border-tag-error-border',
  cancelled: 'bg-tag-neutral-bg text-tag-neutral-text border-tag-neutral-border',
};

export function runStatusLabel(status: RunStatusDto) {
  return labelByStatus[status];
}

export function isTerminalRunStatus(status: RunStatusDto) {
  return TERMINAL_RUN_STATUSES.has(status);
}

export function RunStatusPill({status, size = 'md'}: {status: RunStatusDto; size?: 'sm' | 'md'}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-5 rounded-4 border ${pillClassByStatus[status]} ${
        size === 'sm' ? 'px-6 py-1' : 'px-7 py-2'
      }`}
    >
      <StatusDot variant={runStatusVariant[status]} pulse={status === 'running'} />
      <Text size="xs" bold>
        {runStatusLabel(status)}
      </Text>
    </span>
  );
}
