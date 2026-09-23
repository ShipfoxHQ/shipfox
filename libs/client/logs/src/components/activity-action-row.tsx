'use client';

import {Icon, type IconName} from '@shipfox/react-ui/icon';
import {
  LogContent,
  LogDisclosure,
  LogDisclosureContent,
  LogDisclosureTrigger,
} from '@shipfox/react-ui/log';
import {Markdown} from '@shipfox/react-ui/markdown';
import {cn, formatDuration} from '@shipfox/react-ui/utils';
import {useEffect, useState} from 'react';
import {
  type ActionPresentation,
  type ActivityState,
  genericActionPresentation,
  type PairedAction,
} from '#core/activity.js';

export interface ActivityActionRowProps {
  action: PairedAction;
  indent: number;
  terminated: boolean;
  forceOpen?: boolean;
  presentation?: ActionPresentation | undefined;
}

export function ActivityActionRow({
  action,
  indent,
  terminated,
  forceOpen = false,
  presentation,
}: ActivityActionRowProps) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);

  const resolvedPresentation = presentation ?? genericActionPresentation(action);
  const target = resolvedPresentation.target;
  return (
    <LogDisclosure indent={indent} open={forceOpen || open} onOpenChange={setOpen}>
      <LogDisclosureTrigger
        lineNumber={action.lineNumber}
        timestamp={new Date(action.timestamp)}
        summary={target ?? 'recorded action'}
        trailing={
          <ActionStatus
            state={action.state}
            durationMs={action.durationMs}
            terminated={terminated}
          />
        }
        className={cn(
          action.state === 'failed' && 'text-foreground-contrast-primary',
          action.state === 'no-result' && 'text-foreground-contrast-secondary',
        )}
      >
        <span className="inline-flex min-w-0 items-center gap-inline">
          <ActionIcon kind={resolvedPresentation.iconKind} state={action.state} />
          <span className="truncate">{resolvedPresentation.label}</span>
        </span>
      </LogDisclosureTrigger>
      <LogDisclosureContent>
        <div className="flex min-w-0 flex-col gap-inline">
          {action.request ? (
            <ActionDetail
              label="Request"
              value={action.request.input}
              kind={resolvedPresentation.detailKind}
            />
          ) : null}
          {action.result ? (
            <ActionDetail
              label="Result"
              value={action.result.output}
              kind={resolvedPresentation.detailKind}
            />
          ) : null}
          {action.request === null && action.result === null ? (
            <LogContent className="text-foreground-contrast-secondary">
              No recorded details.
            </LogContent>
          ) : null}
        </div>
      </LogDisclosureContent>
    </LogDisclosure>
  );
}

function ActionDetail({
  label,
  value,
  kind,
}: {
  label: string;
  value: string;
  kind: ActionPresentation['detailKind'];
}) {
  return (
    <div className="flex min-w-0 flex-col gap-tight">
      <span className="font-display text-xs font-medium text-foreground-contrast-secondary">
        {label}
      </span>
      {kind === 'markdown' ? (
        <Markdown className="text-foreground-contrast-primary">{value}</Markdown>
      ) : (
        <LogContent variant="code" className="text-foreground-contrast-primary">
          {value}
        </LogContent>
      )}
    </div>
  );
}

function ActionIcon({kind, state}: {kind: ActionPresentation['iconKind']; state: ActivityState}) {
  let icon: IconName = kind === 'unknown' ? 'questionLine' : 'terminalBoxLine';
  if (state === 'failed') icon = 'closeCircleLine';
  if (state === 'succeeded') icon = 'checkCircleLine';
  if (state === 'no-result') icon = 'errorWarningLine';
  return (
    <Icon
      name={icon}
      className={cn('size-14 flex-none', actionStateClass(state))}
      aria-hidden="true"
    />
  );
}

function ActionStatus({
  state,
  durationMs,
  terminated,
}: {
  state: ActivityState;
  durationMs: number | null;
  terminated: boolean;
}) {
  if (state === 'running' && !terminated) {
    return (
      <span className="inline-flex items-center gap-tight text-foreground-contrast-secondary">
        <Icon name="loader4Line" className="size-12 motion-safe:animate-spin" aria-hidden="true" />
        <span>running</span>
      </span>
    );
  }

  const label = actionStatusLabel(state);
  return (
    <span className={cn('inline-flex items-center gap-tight', actionStateClass(state))}>
      <span>{label}</span>
      {durationMs !== null ? <span className="font-code">{formatDuration(durationMs)}</span> : null}
    </span>
  );
}

function actionStatusLabel(state: ActivityState): string {
  if (state === 'succeeded') return 'succeeded';
  if (state === 'failed') return 'failed';
  return 'no result';
}

function actionStateClass(state: ActivityState): string {
  if (state === 'failed') return 'text-tag-error-icon';
  if (state === 'succeeded') return 'text-tag-success-icon';
  if (state === 'no-result') return 'text-tag-warning-icon';
  return 'text-tag-blue-icon';
}
