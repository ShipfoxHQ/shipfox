'use client';

import {IntegrationIcon} from '@shipfox/integration-icons';
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
  hideIcon?: boolean;
  onOpenChange?: ((open: boolean) => void) | undefined;
}

export function ActivityActionRow({
  action,
  indent,
  terminated,
  forceOpen = false,
  presentation,
  hideIcon = false,
  onOpenChange,
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
    <LogDisclosure
      indent={indent}
      open={forceOpen || open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        onOpenChange?.(nextOpen);
      }}
    >
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
          {hideIcon ? null : <ActionIdentityIcon presentation={resolvedPresentation} />}
          <span className="truncate">{actionDisplayLabel(resolvedPresentation)}</span>
        </span>
      </LogDisclosureTrigger>
      <LogDisclosureContent className="border-l-0 pb-row">
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
  const long = detail.kind !== 'structured' && detail.value.length > DETAIL_PREVIEW_LENGTH;
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
  let content = (
    <LogContent variant="code" className="text-foreground-contrast-primary">
      {value}
    </LogContent>
  );
  if (kind === 'markdown') {
    content = <Markdown className="text-foreground-contrast-primary">{value}</Markdown>;
  } else if (kind === 'structured') {
    content = <StructuredResult value={value} />;
  }
  return (
    <div className={detailSurfaceClassName}>
      <span className="sr-only">{label}</span>
      {content}
    </div>
  );
}

function StructuredResult({value}: {value: string}) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return <LogContent className="whitespace-pre-wrap break-words">{value}</LogContent>;
  }
  return <StructuredValue value={parsed} depth={0} />;
}

function StructuredValue({value, depth}: {value: unknown; depth: number}) {
  const [showAll, setShowAll] = useState(false);
  if (value === null || typeof value !== 'object' || depth >= 3) {
    let text: string;
    try {
      text = typeof value === 'string' ? value : JSON.stringify(value);
    } catch {
      text = '[Nested value omitted]';
    }
    return <LogContent className="whitespace-pre-wrap break-words">{text}</LogContent>;
  }
  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index + 1), item] as const)
    : Object.entries(value);
  if (entries.length === 0) {
    return <LogContent>{Array.isArray(value) ? '[]' : '{}'}</LogContent>;
  }
  return (
    <div className={cn('flex min-w-0 flex-col', depth > 0 && 'gap-inline')}>
      {entries.slice(0, showAll ? undefined : 30).map(([key, item]) => (
        <StructuredEntry
          key={key}
          label={structuredEntryLabel(key, value)}
          item={item}
          depth={depth}
        />
      ))}
      {entries.length > 30 && !showAll ? (
        <button
          type="button"
          className="w-fit cursor-pointer text-foreground-contrast-secondary underline"
          onClick={() => setShowAll(true)}
        >
          Show all {entries.length} {collectionLabel(value)}
        </button>
      ) : null}
    </div>
  );
}

function structuredEntryLabel(key: string, collection: unknown): string {
  return Array.isArray(collection) ? `Item ${key}` : key;
}

function collectionLabel(value: unknown): string {
  return Array.isArray(value) ? 'items' : 'fields';
}

function StructuredEntry({label, item, depth}: {label: string; item: unknown; depth: number}) {
  const isGroup = item !== null && typeof item === 'object' && depth < 2;
  const heading =
    isGroup && Array.isArray(item)
      ? `${label} · ${item.length} ${item.length === 1 ? 'item' : 'items'}`
      : label;
  return (
    <div
      className={cn(
        'min-w-0',
        depth === 0 &&
          'border-b border-border-contrast-base pb-8 pt-6 first:pt-0 last:border-0 last:pb-0',
      )}
    >
      <span
        className={cn(
          'font-display text-xs text-foreground-contrast-secondary',
          isGroup && 'font-medium text-foreground-contrast-primary',
        )}
      >
        {heading}
      </span>
      <div className={isGroup ? 'min-w-0 pl-12 pt-tight' : undefined}>
        <StructuredValue value={item} depth={depth + 1} />
      </div>
    </div>
  );
}

export function actionDisplayLabel(presentation: ActionPresentation): string {
  return presentation.integration
    ? `${providerLabel(presentation.integration.provider)} · ${presentation.label}`
    : presentation.label;
}

function providerLabel(provider: string): string {
  const labels: Record<string, string> = {
    github: 'GitHub',
    gitlab: 'GitLab',
    gitea: 'Gitea',
    clickup: 'ClickUp',
    posthog: 'PostHog',
  };
  return (
    labels[provider] ??
    provider.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
  );
}

export function ActionIdentityIcon({presentation}: {presentation: ActionPresentation}) {
  if (presentation.integration) {
    return (
      <IntegrationIcon
        source={presentation.integration.provider}
        className="size-14 flex-none"
        aria-hidden="true"
      />
    );
  }
  return <ActionIcon kind={presentation.iconKind} />;
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
    integration: 'componentLine',
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
      {state === 'failed' ? (
        <Icon name="closeCircleFill" className="size-14" aria-hidden="true" />
      ) : null}
      {detail ? <span className="font-code">{detail}</span> : null}
      {detail && durationMs !== null ? (
        <span aria-hidden="true" className="h-12 border-l border-border-contrast-base" />
      ) : null}
      {durationMs !== null ? <span className="font-code">{formatDuration(durationMs)}</span> : null}
    </span>
  );
}
