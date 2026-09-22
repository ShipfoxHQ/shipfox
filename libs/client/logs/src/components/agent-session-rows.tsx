'use client';

import {Icon, type IconName} from '@shipfox/react-ui/icon';
import {
  LogContent,
  LogDisclosure,
  LogDisclosureContent,
  LogDisclosureTrigger,
  LogRow,
} from '@shipfox/react-ui/log';
import {Markdown} from '@shipfox/react-ui/markdown';
import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui/tooltip';
import {cn} from '@shipfox/react-ui/utils';
import {Fragment, useEffect, useState} from 'react';
import type {SessionViewRow, SessionViewRowMeta} from '#core/log-model.js';

const PREVIEW_CHAR_LIMIT = 1200;
const WORD_SUMMARY_CHAR_LIMIT = 5000;
const WHITESPACE = /\s+/g;
const WORD_SEPARATOR = /\s+/;
const ROUTINE_SETUP_LABEL = /^(session started|turn \d+ started)$/i;

export interface AgentSessionRowsProps {
  rows: readonly SessionViewRow[];
  lineNumber: number;
  resolvedToolCallIds: ReadonlySet<string>;
  toolCallNames: ReadonlyMap<string, string>;
  indent: number;
  forceOpen?: boolean;
}

export function AgentSessionRows({
  rows,
  lineNumber,
  resolvedToolCallIds,
  toolCallNames,
  indent,
  forceOpen = false,
}: AgentSessionRowsProps) {
  return rows.map((row, index) => (
    <AgentSessionRowView
      // biome-ignore lint/suspicious/noArrayIndexKey: session rows are immutable and never reordered, so the index is stable; content keys would balloon to megabyte strings and collide on repeated id-less tool calls.
      key={`${row.kind}-${index}`}
      row={row}
      lineNumber={lineNumber + index}
      resolvedToolCallIds={resolvedToolCallIds}
      toolCallNames={toolCallNames}
      indent={indent}
      forceOpen={forceOpen}
    />
  ));
}

function AgentSessionRowView({
  row,
  lineNumber,
  resolvedToolCallIds,
  toolCallNames,
  indent,
  forceOpen,
}: {
  row: SessionViewRow;
  lineNumber: number;
  resolvedToolCallIds: ReadonlySet<string>;
  toolCallNames: ReadonlyMap<string, string>;
  indent: number;
  forceOpen: boolean;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);
  const disclosureProps = {open: forceOpen || open, onOpenChange: setOpen};

  switch (row.kind) {
    case 'message':
      return <SessionMessageRow row={row} lineNumber={lineNumber} indent={indent} />;
    case 'thinking':
      return (
        <SessionThinkingRow
          row={row}
          lineNumber={lineNumber}
          indent={indent}
          disclosure={disclosureProps}
        />
      );
    case 'tool-call':
      return (
        <SessionToolCallRow
          row={row}
          lineNumber={lineNumber}
          indent={indent}
          disclosure={disclosureProps}
          resolvedToolCallIds={resolvedToolCallIds}
        />
      );
    case 'tool-result':
      return (
        <SessionToolResultRow
          row={row}
          lineNumber={lineNumber}
          indent={indent}
          disclosure={disclosureProps}
          toolCallNames={toolCallNames}
        />
      );
    case 'lifecycle':
      return (
        <SessionLifecycleRow
          row={row}
          lineNumber={lineNumber}
          indent={indent}
          disclosure={disclosureProps}
        />
      );
    case 'raw':
      return (
        <SessionRawRow
          row={row}
          lineNumber={lineNumber}
          indent={indent}
          disclosure={disclosureProps}
        />
      );
    default:
      return assertNever(row);
  }
}

type DisclosureState = {open: boolean; onOpenChange: (open: boolean) => void};

function SessionMessageRow({
  row,
  lineNumber,
  indent,
}: {
  row: Extract<SessionViewRow, {kind: 'message'}>;
  lineNumber: number;
  indent: number;
}) {
  return (
    <LogRow
      lineNumber={lineNumber}
      timestamp={new Date(row.timestamp)}
      indent={indent}
      tone={row.terminalFailure ? 'error' : 'default'}
      data-log-terminal-failure={row.terminalFailure ? 'true' : undefined}
    >
      <div className="flex min-w-0 items-start gap-inline text-foreground-contrast-primary">
        <MessageIcon role={row.role} terminalFailure={row.terminalFailure} />
        <div className="flex min-w-0 flex-1 flex-col gap-tight">
          <div className="flex min-w-0 items-center gap-inline">
            <MessageRoleLabel label={row.label} terminalFailure={row.terminalFailure} />
            <RowMetadata meta={row.meta} className="ml-auto flex-none" />
          </div>
          <div className="block min-w-0">
            <MarkdownPreview text={row.text} />
          </div>
        </div>
      </div>
    </LogRow>
  );
}

function SessionThinkingRow({
  row,
  lineNumber,
  indent,
  disclosure,
}: {
  row: Extract<SessionViewRow, {kind: 'thinking'}>;
  lineNumber: number;
  indent: number;
  disclosure: DisclosureState;
}) {
  if (!row.text.trim()) return null;

  return (
    <LogDisclosure indent={indent} {...disclosure}>
      <LogDisclosureTrigger
        lineNumber={lineNumber}
        summary={wordSummary(row.text)}
        timestamp={new Date(row.timestamp)}
        className="text-foreground-contrast-secondary"
      >
        thinking
      </LogDisclosureTrigger>
      <LogDisclosureContent className="text-foreground-contrast-secondary">
        <LogContent className="text-foreground-contrast-secondary">
          <PreviewText text={row.text} />
        </LogContent>
      </LogDisclosureContent>
    </LogDisclosure>
  );
}

function SessionToolCallRow({
  row,
  lineNumber,
  indent,
  disclosure,
  resolvedToolCallIds,
}: {
  row: Extract<SessionViewRow, {kind: 'tool-call'}>;
  lineNumber: number;
  indent: number;
  disclosure: DisclosureState;
  resolvedToolCallIds: ReadonlySet<string>;
}) {
  const awaitingResult = row.id != null && !resolvedToolCallIds.has(row.id);
  return (
    <LogDisclosure indent={indent} {...disclosure}>
      <LogDisclosureTrigger
        lineNumber={lineNumber}
        timestamp={new Date(row.timestamp)}
        summary={compactPreview(row.summary ?? row.input)}
        trailing={
          awaitingResult ? (
            <span className="inline-flex items-center gap-tight">
              <Icon
                name="loader4Line"
                className="size-12 motion-safe:animate-spin"
                aria-hidden="true"
              />
              awaiting result
            </span>
          ) : null
        }
      >
        <span className="inline-flex min-w-0 items-center gap-inline">
          <Icon name="terminalBoxLine" className="size-14 flex-none" aria-hidden="true" />
          <span className="truncate">tool {row.name}</span>
        </span>
      </LogDisclosureTrigger>
      <LogDisclosureContent>
        {row.summary != null ? (
          <>
            <LogContent>
              <PreviewText text={row.summary} />
            </LogContent>
            <LogContent variant="code">
              <PreviewText text={row.input} />
            </LogContent>
          </>
        ) : (
          <LogContent variant="code">
            <PreviewText text={row.input} />
          </LogContent>
        )}
      </LogDisclosureContent>
    </LogDisclosure>
  );
}

function SessionToolResultRow({
  row,
  lineNumber,
  indent,
  disclosure,
  toolCallNames,
}: {
  row: Extract<SessionViewRow, {kind: 'tool-result'}>;
  lineNumber: number;
  indent: number;
  disclosure: DisclosureState;
  toolCallNames: ReadonlyMap<string, string>;
}) {
  const toolName =
    row.toolName === 'tool'
      ? ((row.toolCallId != null ? toolCallNames.get(row.toolCallId) : undefined) ?? '(unmatched)')
      : row.toolName;
  return (
    <LogDisclosure indent={indent} {...disclosure}>
      <LogDisclosureTrigger
        lineNumber={lineNumber}
        timestamp={new Date(row.timestamp)}
        summary={compactPreview(row.output)}
        trailing={
          <span
            className={cn(
              'inline-flex items-center gap-tight',
              row.isError ? 'text-tag-error-icon' : 'text-foreground-contrast-secondary',
            )}
          >
            <Icon
              name={row.isError ? 'closeCircleLine' : 'checkLine'}
              className="size-12"
              aria-hidden="true"
            />
            {row.isError ? 'error' : 'ok'}
          </span>
        }
      >
        <span className="inline-flex min-w-0 items-center gap-inline">
          <Icon name="terminalWindowLine" className="size-14 flex-none" aria-hidden="true" />
          <span className="truncate">result {toolName}</span>
        </span>
      </LogDisclosureTrigger>
      <LogDisclosureContent>
        <LogContent variant="code" className="text-foreground-contrast-primary">
          <PreviewText text={row.output} />
        </LogContent>
      </LogDisclosureContent>
    </LogDisclosure>
  );
}

function SessionLifecycleRow({
  row,
  lineNumber,
  indent,
  disclosure,
}: {
  row: Extract<SessionViewRow, {kind: 'lifecycle'}>;
  lineNumber: number;
  indent: number;
  disclosure: DisclosureState;
}) {
  if (isRoutineSetup(row.label)) {
    return (
      <LogDisclosure indent={indent} {...disclosure}>
        <LogDisclosureTrigger
          lineNumber={lineNumber}
          timestamp={new Date(row.timestamp)}
          summary="setup"
          className="text-foreground-contrast-secondary"
        >
          {row.label}
        </LogDisclosureTrigger>
        <LogDisclosureContent className="text-foreground-contrast-secondary">
          <LogContent className="text-foreground-contrast-secondary">
            {row.detail ?? row.meta.map((meta) => `${meta.label}: ${meta.value}`).join(' · ')}
          </LogContent>
        </LogDisclosureContent>
      </LogDisclosure>
    );
  }

  return (
    <LogRow
      lineNumber={lineNumber}
      timestamp={new Date(row.timestamp)}
      indent={indent}
      tone={row.tone}
      data-log-terminal-failure={row.terminalFailure ? 'true' : undefined}
    >
      <LogContent className="text-foreground-contrast-secondary">
        <span className="inline-flex w-full items-center gap-inline">
          <Icon
            name={lifecycleIcon(row.tone)}
            className={cn(
              'size-14 flex-none',
              row.tone === 'success' && 'text-tag-success-icon',
              row.tone === 'warning' && 'text-tag-warning-icon',
              row.tone === 'error' && 'text-tag-error-icon',
            )}
            aria-hidden="true"
          />
          <span className="min-w-0">
            <span className="font-medium">{row.label}</span>
            {row.detail != null ? (
              <>
                {' · '}
                <span className="text-foreground-contrast-secondary">{row.detail}</span>
              </>
            ) : null}
          </span>
          <span
            aria-hidden="true"
            className="h-px flex-1 border-t border-dashed border-current opacity-30"
          />
          <RowMetadata meta={row.meta} />
        </span>
      </LogContent>
    </LogRow>
  );
}

function isRoutineSetup(label: string): boolean {
  return ROUTINE_SETUP_LABEL.test(label.trim());
}

function lifecycleIcon(tone: Extract<SessionViewRow, {kind: 'lifecycle'}>['tone']): IconName {
  if (tone === 'success') return 'checkCircleLine';
  if (tone === 'warning') return 'errorWarningLine';
  if (tone === 'error') return 'closeCircleLine';
  return 'informationLine';
}

function SessionRawRow({
  row,
  lineNumber,
  indent,
  disclosure,
}: {
  row: Extract<SessionViewRow, {kind: 'raw'}>;
  lineNumber: number;
  indent: number;
  disclosure: DisclosureState;
}) {
  return (
    <LogDisclosure indent={indent} {...disclosure}>
      <LogDisclosureTrigger
        lineNumber={lineNumber}
        timestamp={new Date(row.timestamp)}
        summary={compactPreview(row.raw)}
        className="text-foreground-contrast-primary"
      >
        <span className="inline-flex min-w-0 items-center gap-inline">
          <Icon
            name="errorWarningLine"
            className="size-14 flex-none text-tag-warning-icon"
            aria-hidden="true"
          />
          <span className="truncate">{row.label}</span>
        </span>
      </LogDisclosureTrigger>
      <LogDisclosureContent>
        <LogContent variant="code">
          <PreviewText text={row.raw} />
        </LogContent>
      </LogDisclosureContent>
    </LogDisclosure>
  );
}

function MessageIcon({role, terminalFailure}: {role: string; terminalFailure: boolean}) {
  let name: IconName = 'message2Line';
  if (terminalFailure) name = 'closeCircleLine';
  else if (role === 'user') name = 'userLine';
  else if (role === 'assistant') name = 'robot2Line';

  return (
    <Icon
      name={name}
      className={cn(
        'mt-[2px] size-14 flex-none',
        terminalFailure ? 'text-tag-error-icon' : 'text-foreground-contrast-secondary',
      )}
      aria-hidden="true"
    />
  );
}

function MessageRoleLabel({label, terminalFailure}: {label: string; terminalFailure: boolean}) {
  return (
    <span
      className={cn(
        'min-w-0 font-code text-foreground-contrast-secondary',
        terminalFailure && 'text-foreground-contrast-primary',
      )}
    >
      <span className="truncate">{label}</span>
    </span>
  );
}

function RowMetadata({meta, className}: {meta: readonly SessionViewRowMeta[]; className?: string}) {
  if (meta.length === 0) return null;

  const inlineMeta = meta.length === 1 && meta[0]?.inline !== false ? meta[0] : null;
  if (inlineMeta != null) {
    return (
      <span
        className={cn('font-code text-xs text-foreground-contrast-secondary', className)}
        title={`${inlineMeta.label}: ${inlineMeta.value}`}
      >
        {inlineMeta.value}
      </span>
    );
  }

  return (
    <span className={className}>
      <MetadataTrigger meta={meta} />
    </span>
  );
}

function MetadataTrigger({meta}: {meta: readonly SessionViewRowMeta[]}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex size-20 flex-none items-center justify-center rounded-4 text-foreground-contrast-secondary opacity-60 transition-opacity hover:bg-background-components-hover hover:text-foreground-contrast-primary hover:opacity-100 focus-visible:opacity-100 focus-visible:shadow-focus-inset group-hover/log-row:opacity-100"
          aria-label="Show message metadata"
        >
          <Icon name="informationLine" className="size-12" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent align="end" variant="inverted" className="max-w-360 p-tight">
        <span className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-[var(--space-inline)] gap-y-[var(--space-tight)] font-code text-xs">
          {meta.map((item) => (
            <Fragment key={`${item.label}-${item.value}`}>
              <span className="text-foreground-contrast-secondary">{item.label}</span>
              <span className="min-w-0 break-all text-foreground-contrast-primary">
                {item.value}
              </span>
            </Fragment>
          ))}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

function MarkdownPreview({text}: {text: string}) {
  const [expanded, setExpanded] = useState(false);
  const truncated = text.length > PREVIEW_CHAR_LIMIT;
  const visible = truncated && !expanded ? `${text.slice(0, PREVIEW_CHAR_LIMIT)}…` : text;

  return (
    <>
      <Markdown className="text-foreground-contrast-primary">{visible}</Markdown>
      {truncated ? (
        <button
          type="button"
          aria-expanded={expanded}
          className="ms-inline inline-flex min-h-24 items-center rounded-4 px-tight font-display text-xs text-foreground-highlight-interactive focus-visible:shadow-focus-inset"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'show less' : 'show more'}
        </button>
      ) : null}
    </>
  );
}

function PreviewText({text}: {text: string}) {
  const [expanded, setExpanded] = useState(false);
  const truncated = text.length > PREVIEW_CHAR_LIMIT;
  const visible = truncated && !expanded ? `${text.slice(0, PREVIEW_CHAR_LIMIT)}…` : text;

  return (
    <>
      {visible}
      {truncated ? (
        <button
          type="button"
          aria-expanded={expanded}
          className="ms-inline inline-flex min-h-24 items-center rounded-4 px-tight font-display text-xs text-foreground-highlight-interactive focus-visible:shadow-focus-inset"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'show less' : 'show more'}
        </button>
      ) : null}
    </>
  );
}

function compactPreview(value: string): string {
  // Normalize only a bounded head: tool output can be megabytes, and this runs
  // per render for every disclosure trigger.
  const head = value.length > 200 ? value.slice(0, 200) : value;
  const singleLine = head.replace(WHITESPACE, ' ').trim();
  if (singleLine.length <= 80) return singleLine;
  return `${singleLine.slice(0, 80)}…`;
}

function wordSummary(value: string): string {
  const truncated = value.length > WORD_SUMMARY_CHAR_LIMIT;
  const head = truncated ? value.slice(0, WORD_SUMMARY_CHAR_LIMIT) : value;
  const count = head.trim().split(WORD_SEPARATOR).filter(Boolean).length;
  const marker = truncated ? '+' : '';
  return `${count}${marker} ${count === 1 ? 'word' : 'words'}`;
}

function assertNever(value: never): never {
  throw new Error(`unexpected agent session row: ${JSON.stringify(value)}`);
}
