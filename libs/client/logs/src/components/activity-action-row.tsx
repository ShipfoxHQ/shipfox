'use client';

import {Icon, type IconName} from '@shipfox/react-ui/icon';
import {
  LogContent,
  LogDisclosure,
  LogDisclosureContent,
  LogDisclosureTrigger,
} from '@shipfox/react-ui/log';
import {Markdown} from '@shipfox/react-ui/markdown';
import {Code} from '@shipfox/react-ui/typography';
import {cn, formatDuration} from '@shipfox/react-ui/utils';
import {useEffect, useMemo, useState} from 'react';
import {
  type ActionPresentation,
  type ActivityState,
  genericActionPresentation,
  type PairedAction,
} from '#core/activity.js';
import {nativePresentationFromPayload} from '#core/native-tools.js';

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

  const requestName = action.request?.name;
  const requestInput = action.request?.input;
  const resultOutput = action.result?.output;
  const nativePresentation = useMemo(
    () =>
      requestName && requestInput
        ? nativePresentationFromPayload(requestName, requestInput, resultOutput)
        : undefined,
    [requestName, requestInput, resultOutput],
  );
  const resolvedPresentation =
    presentation ?? nativePresentation ?? genericActionPresentation(action);
  const target = resolvedPresentation.target;
  const hasPresentedDetail = resolvedPresentation.detail !== undefined;
  return (
    <LogDisclosure indent={indent} open={forceOpen || open} onOpenChange={setOpen}>
      <LogDisclosureTrigger
        lineNumber={action.lineNumber}
        timestamp={new Date(action.timestamp)}
        summary={
          hasPresentedDetail && target ? (
            <Code as="span" className="truncate">
              {target}
            </Code>
          ) : (
            (target ?? 'recorded action')
          )
        }
        trailing={
          <ActionStatus
            state={action.state}
            durationMs={action.durationMs}
            terminated={terminated}
            detail={resolvedPresentation.statusDetail}
          />
        }
        className={cn(
          action.state === 'failed' && 'text-foreground-contrast-primary',
          action.state === 'no-result' && 'text-foreground-contrast-secondary',
        )}
      >
        <span className="inline-flex min-w-0 items-center gap-inline">
          <ActionIcon kind={resolvedPresentation.iconKind} />
          <span className="truncate">{resolvedPresentation.label}</span>
        </span>
      </LogDisclosureTrigger>
      <LogDisclosureContent>
        {hasPresentedDetail ? (
          <PresentedDetails detail={resolvedPresentation.detail ?? null} />
        ) : (
          <GenericDetails action={action} kind={resolvedPresentation.detailKind} />
        )}
      </LogDisclosureContent>
    </LogDisclosure>
  );
}

function PresentedDetails({detail}: {detail: NonNullable<ActionPresentation['detail']> | null}) {
  return detail ? (
    <PresentedActionDetail detail={detail} />
  ) : (
    <div className={detailSurfaceClassName}>
      <LogContent className="text-foreground-contrast-secondary">
        No recorded result yet.
      </LogContent>
    </div>
  );
}

function GenericDetails({
  action,
  kind,
}: {
  action: PairedAction;
  kind: ActionPresentation['detailKind'];
}) {
  return (
    <div className="flex min-w-0 flex-col gap-inline">
      {action.request ? (
        <ActionDetail label="Request" value={action.request.input} kind={kind} />
      ) : null}
      {action.result ? (
        <ActionDetail label="Result" value={action.result.output} kind={kind} />
      ) : null}
      {action.request === null && action.result === null ? (
        <LogContent className="text-foreground-contrast-secondary">No recorded details.</LogContent>
      ) : null}
    </div>
  );
}

const DETAIL_PREVIEW_LENGTH = 5000;
const detailSurfaceClassName =
  'min-w-0 rounded-6 border border-border-contrast-bottom bg-background-contrast-base px-12 py-8';

function PresentedActionDetail({detail}: {detail: NonNullable<ActionPresentation['detail']>}) {
  const [showFull, setShowFull] = useState(false);
  const long = detail.value.length > DETAIL_PREVIEW_LENGTH;
  return (
    <div className="min-w-0">
      <ActionDetail
        label={detail.label}
        value={
          long && !showFull ? `${detail.value.slice(0, DETAIL_PREVIEW_LENGTH)}…` : detail.value
        }
        kind={detail.kind}
      />
      {long && !showFull ? (
        <button
          type="button"
          className="mt-tight cursor-pointer text-foreground-contrast-secondary underline"
          onClick={() => setShowFull(true)}
        >
          Show full result
        </button>
      ) : null}
    </div>
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
    <div className={detailSurfaceClassName}>
      <span className="sr-only">{label}</span>
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

function ActionIcon({kind}: {kind: ActionPresentation['iconKind']}) {
  const icons: Record<ActionPresentation['iconKind'], IconName> = {
    tool: 'terminalBoxLine',
    unknown: 'questionLine',
    file: 'fileTextLine',
    edit: 'editLine',
    write: 'fileAddLine',
    shell: 'terminalBoxLine',
    search: 'searchLine',
    list: 'folderLine',
  };
  return (
    <Icon
      name={icons[kind]}
      className="size-14 flex-none text-foreground-contrast-secondary"
      aria-hidden="true"
    />
  );
}

function ActionStatus({
  state,
  durationMs,
  terminated,
  detail,
}: {
  state: ActivityState;
  durationMs: number | null;
  terminated: boolean;
  detail?: string | undefined;
}) {
  if (state === 'running' && !terminated) {
    return (
      <span className="inline-flex items-center gap-tight text-foreground-contrast-secondary">
        <Icon name="loader4Line" className="size-12 motion-safe:animate-spin" aria-hidden="true" />
        <span>running</span>
      </span>
    );
  }

  const completed = state === 'succeeded' || state === 'failed';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-inline',
        state === 'failed' ? 'text-tag-error-icon' : 'text-foreground-contrast-secondary',
      )}
    >
      <span className={completed ? 'sr-only' : undefined}>{completed ? state : 'no result'}</span>
      {completed && durationMs === null && !detail ? (
        <Icon
          name={state === 'failed' ? 'closeCircleFill' : 'checkboxCircleFill'}
          className="size-14"
          aria-hidden="true"
        />
      ) : null}
      {detail ? (
        <span className="rounded-4 border border-border-contrast-bottom bg-background-contrast-base px-tight font-code">
          {detail}
        </span>
      ) : null}
      {durationMs !== null ? <span className="font-code">{formatDuration(durationMs)}</span> : null}
    </span>
  );
}
