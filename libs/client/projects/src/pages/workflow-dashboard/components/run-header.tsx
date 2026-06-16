import {Button, Code, Header, Icon, Text} from '@shipfox/react-ui';
import {formatDuration, formatRelativeTime} from '../lib/workflow-dashboard-format.js';
import type {WorkflowDashboardRun} from '../workflow-dashboard-types.js';
import {StatusDot, WorkflowStatusBadge} from './status-badge.js';

const previewNowIso = '2026-06-12T12:10:00Z';

export function RunHeader({
  onJumpToFocus,
  onSource,
  run,
}: {
  onJumpToFocus: () => void;
  onSource: () => void;
  run: WorkflowDashboardRun;
}) {
  const focusLabel =
    run.status === 'failed'
      ? 'Go to root cause'
      : run.status === 'running'
        ? 'Go to active step'
        : null;

  return (
    <div className="sticky top-0 z-20 border-border-neutral-base border-b bg-background-components-base px-22 py-13">
      <div className="flex flex-wrap items-center gap-12">
        <StatusDot pulse status={run.status} />
        <Header variant="h3" as="h1" className="font-code">
          Run #{run.number}
        </Header>
        <WorkflowStatusBadge status={run.status} size="xs" />
        <span className="h-18 w-1 bg-border-neutral-base" />
        <button
          className="inline-flex h-28 items-center gap-6 rounded-4 border border-transparent px-6 text-foreground-neutral-subtle hover:border-border-neutral-base hover:bg-background-components-hover hover:text-foreground-neutral-base focus-visible:shadow-button-neutral-focus focus-visible:outline-none"
          title="View alert details"
          type="button"
        >
          <Icon name="sentry" className="size-14 text-foreground-neutral-muted" />
          <Code as="span" variant="label">
            {run.trigger.incident}
          </Code>
          <Icon name="externalLinkLine" className="size-12 text-foreground-neutral-muted" />
        </button>
        <span className="inline-flex items-center gap-6 text-foreground-neutral-subtle">
          <Icon name="timeLine" className="size-14 text-foreground-neutral-muted" />
          <Code as="span" variant="label">
            {formatDuration(run.duration)}
          </Code>
        </span>
        {run.status !== 'running' && (
          <Text as="span" size="xs" className="text-foreground-neutral-muted">
            updated{' '}
            <Code as="span" variant="label">
              {formatRelativeTime(run.observedUntil, previewNowIso)}
            </Code>
          </Text>
        )}
        <span className="flex-1" />
        <div className="flex items-center gap-8">
          {focusLabel && (
            <Button size="sm" iconRight="arrowRightLine" onClick={onJumpToFocus}>
              {focusLabel}
            </Button>
          )}
          <Button size="sm" variant="secondary" iconLeft="fileCodeLine" onClick={onSource}>
            Workflow source
          </Button>
          {run.status === 'running' ? (
            <Button size="sm" variant="danger" iconLeft="stopCircleLine">
              Cancel run
            </Button>
          ) : (
            <Button size="sm" variant="secondary" iconLeft="refreshLine">
              Re-run
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
