'use client';

import {Icon} from '@shipfox/react-ui/icon';
import {LogContent, LogRow, LogRows, type LogTimestampMode} from '@shipfox/react-ui/log';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {
  type ReactNode,
  type RefObject,
  type UIEventHandler,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  type ActionPresentationLookup,
  type ActivityNode,
  buildActivityNodes,
  groupActivityReads,
  resolveActionPresentation,
} from '#core/activity.js';
import type {LogRecord} from '#core/log-model.js';
import {buildLogSearchIndex, filterActivityNodes} from '#core/log-search.js';
import {assertNever, buildLogTree, type LogTree, type MarkerLogRecord} from '#core/log-tree.js';
import {ActivityActionRow} from './activity-action-row.js';
import {ActivityReadGroup} from './activity-read-group.js';
import {AgentSessionRows} from './agent-session-rows.js';
import {LogGroup} from './log-group.js';
import {OutputLogRow} from './output-log-row.js';
import {
  CappedMarker,
  EndMarker,
  GapMarker,
  RunCancelledMarker,
  RunnerLostMarker,
  TimedOutMarker,
} from './system-markers.js';

export interface LogViewProps {
  records: readonly LogRecord[];
  timestamps?: LogTimestampMode;
  onTimestampsClick?: (() => void) | undefined;
  wrap?: boolean;
  showLineNumbers?: boolean;
  emptyState?: 'complete' | 'pending';
  truncated?: boolean | undefined;
  defaultGroupsOpen?: boolean;
  anchorToFailure?: boolean;
  search?: string;
  attemptStatus?: string | undefined;
  actionPresentation?: ActionPresentationLookup | undefined;
  ariaLive?: 'off' | 'polite' | 'assertive';
  className?: string | undefined;
  onScroll?: UIEventHandler<HTMLDivElement> | undefined;
  scrollContainerRef?: RefObject<HTMLElement | null> | undefined;
}

export interface LogViewSkeletonProps
  extends Pick<LogViewProps, 'timestamps' | 'wrap' | 'showLineNumbers' | 'className'> {
  rows?: number;
}

export function LogView({
  records,
  timestamps = 'off',
  onTimestampsClick,
  wrap = false,
  showLineNumbers = true,
  emptyState = 'complete',
  truncated = false,
  defaultGroupsOpen = false,
  anchorToFailure = false,
  search = '',
  attemptStatus,
  actionPresentation,
  ariaLive = 'polite',
  className,
  onScroll,
  scrollContainerRef,
}: LogViewProps) {
  const rowsRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<{seq: string; top: number; atTail: boolean} | null>(null);
  const [focusedActionSeq, setFocusedActionSeq] = useState<number | null>(null);
  const recordTree = useMemo(() => buildLogTree(records), [records]);
  const tree = useMemo(
    () => (truncated && !recordTree.terminated ? {...recordTree, terminated: true} : recordTree),
    [recordTree, truncated],
  );
  const deferredSearch = useDeferredValue(search);
  const searchQuery = deferredSearch.trim();
  const normalizedSearch = searchQuery.toLowerCase();
  const searchIndex = useMemo(() => buildLogSearchIndex(tree.nodes), [tree.nodes]);
  const activityTerminated = tree.terminated || isTerminalAttemptStatus(attemptStatus);
  const activityNodes = useMemo(
    () => buildActivityNodes(tree.nodes, activityTerminated),
    [activityTerminated, tree.nodes],
  );
  const groupedActivityNodes = useMemo(
    () => groupActivityReads(activityNodes, actionPresentation),
    [activityNodes, actionPresentation],
  );
  const visibleActivityNodes = useMemo(
    () =>
      normalizedSearch
        ? filterActivityNodes(groupedActivityNodes, normalizedSearch, searchIndex)
        : groupedActivityNodes,
    [groupedActivityNodes, normalizedSearch, searchIndex],
  );
  const hasIncompleteTerminal = truncated && !recordTree.terminated;
  const noOutputState =
    normalizedSearch || hasIncompleteTerminal ? null : getNoOutputState(tree, emptyState);
  const anchorRecordCount = records.length;
  const searchStatus = getSearchStatus(searchQuery, visibleActivityNodes.length > 0);
  const renderedNodes = useMemo(
    () =>
      renderActivityNodes(
        visibleActivityNodes,
        0,
        tree,
        defaultGroupsOpen,
        Boolean(normalizedSearch),
        activityTerminated,
        actionPresentation,
        focusedActionSeq,
      ),
    [
      actionPresentation,
      activityTerminated,
      defaultGroupsOpen,
      focusedActionSeq,
      normalizedSearch,
      tree,
      visibleActivityNodes,
    ],
  );

  useLayoutEffect(() => {
    const rows = rowsRef.current;
    const scrollElement = scrollContainerRef?.current ?? rows;
    if (!rows || !scrollElement) return;
    if (visibleActivityNodes.length === 0) {
      anchorRef.current = null;
      return;
    }
    const previous = anchorRef.current;
    if (previous && !previous.atTail) {
      const anchor = Array.from(rows.querySelectorAll<HTMLElement>('[data-activity-anchor]')).find(
        (element) =>
          element.dataset.activityAnchor === previous.seq && element.getClientRects().length > 0,
      );
      if (anchor) scrollElement.scrollTop += anchor.getBoundingClientRect().top - previous.top;
    }
    if (focusedActionSeq !== null && !rows.contains(document.activeElement)) {
      const action = rows.querySelector<HTMLElement>(
        `[data-activity-action="${focusedActionSeq}"] button`,
      );
      action?.focus({preventScroll: true});
    }
    anchorRef.current = currentActivityAnchor(rows, scrollElement);
  }, [focusedActionSeq, scrollContainerRef, visibleActivityNodes]);

  useEffect(() => {
    const rows = rowsRef.current;
    const scrollElement = scrollContainerRef?.current ?? rows;
    if (!rows || !scrollElement) return;
    const capture = () => {
      anchorRef.current = currentActivityAnchor(rows, scrollElement);
    };
    scrollElement.addEventListener('scroll', capture, {passive: true});
    return () => scrollElement.removeEventListener('scroll', capture);
  }, [scrollContainerRef]);

  useEffect(() => {
    if (!anchorToFailure) return;
    if (anchorRecordCount === 0) return;

    const frame = scheduleAnimationFrame(() => {
      const rows = rowsRef.current;
      if (!rows) return;

      const failure = rows.querySelector<HTMLElement>('[data-log-terminal-failure="true"]');
      if (failure) {
        failure.scrollIntoView({block: 'center'});
        return;
      }

      rows.scrollTop = rows.scrollHeight;
    });

    return () => cancelScheduledFrame(frame);
  }, [anchorToFailure, anchorRecordCount]);

  return (
    <>
      {searchStatus ? (
        <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {searchStatus}
        </div>
      ) : null}
      <LogRows
        ref={rowsRef}
        timestamps={timestamps}
        wrap={wrap}
        showLineNumbers={showLineNumbers}
        aria-live={normalizedSearch ? 'off' : ariaLive}
        className={className}
        onScroll={onScroll}
        onFocusCapture={(event) => {
          const action = (event.target as HTMLElement).closest<HTMLElement>(
            '[data-activity-action]',
          );
          setFocusedActionSeq(action ? Number(action.dataset.activityAction) : null);
        }}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setFocusedActionSeq(null);
        }}
        {...(onTimestampsClick ? {onTimestampsClick} : {})}
        {...(tree.originTs != null ? {timestampOrigin: new Date(tree.originTs)} : {})}
      >
        {noOutputState ? <NoOutputRow state={noOutputState} /> : null}
        {normalizedSearch && visibleActivityNodes.length === 0 ? (
          <NoSearchMatchesRow query={searchQuery} />
        ) : null}
        {renderedNodes}
        {hasIncompleteTerminal && !normalizedSearch ? <IncompleteLogRow /> : null}
      </LogRows>
    </>
  );
}

function getSearchStatus(query: string, hasMatches: boolean): string | null {
  if (!query) return null;
  return hasMatches ? `Log search updated for “${query}”.` : `No log lines match “${query}”.`;
}

function IncompleteLogRow() {
  return (
    <LogRow lineNumber={null} tone="warning">
      <LogContent className="text-foreground-contrast-primary">
        <span className="inline-flex min-w-0 items-center gap-inline">
          <Icon
            name="errorWarningLine"
            className="size-14 flex-none text-tag-warning-icon"
            aria-hidden="true"
          />
          <span className="min-w-0">
            <span className="font-medium">Log stream incomplete</span>
            {' · '}
            <span className="font-normal opacity-80">some final output may be missing</span>
          </span>
        </span>
      </LogContent>
    </LogRow>
  );
}

export function LogViewSkeleton({
  rows = 5,
  timestamps = 'off',
  wrap = false,
  showLineNumbers = true,
  className,
}: LogViewSkeletonProps) {
  const widths = ['w-[62%]', 'w-[44%]', 'w-[74%]', 'w-[36%]', 'w-[55%]'];
  const skeletonRows = getSkeletonRows(rows);

  return (
    <LogRows
      timestamps={timestamps}
      wrap={wrap}
      showLineNumbers={showLineNumbers}
      className={className}
      role="presentation"
      aria-live="off"
      aria-hidden="true"
    >
      {skeletonRows.map((row) => (
        <LogRow key={row.id} lineNumber={row.lineNumber}>
          <Skeleton
            className={`my-[4px] h-12 ${widths[(row.lineNumber - 1) % widths.length] ?? 'w-[48%]'}`}
          />
        </LogRow>
      ))}
    </LogRows>
  );
}

function getSkeletonRows(rows: number): {id: string; lineNumber: number}[] {
  return Array.from({length: rows}, (_, index) => {
    const lineNumber = index + 1;
    return {id: `log-view-skeleton-row-${lineNumber}`, lineNumber};
  });
}

function getNoOutputState(
  tree: LogTree,
  emptyState: NonNullable<LogViewProps['emptyState']>,
): LogViewProps['emptyState'] | null {
  if (tree.nodes.length === 0) return emptyState;

  if (tree.lineCount !== 0) return null;
  if (tree.nodes.length !== 1) return null;

  const [node] = tree.nodes;
  if (node?.kind === 'marker' && node.record.type === 'end') return 'complete';

  return null;
}

function NoOutputRow({state}: {state: NonNullable<LogViewProps['emptyState']>}) {
  const copy =
    state === 'pending'
      ? {
          title: 'No output yet',
          detail: 'New lines will appear here as the step writes them.',
        }
      : {
          title: 'Step produced no output',
          detail: 'This log stream closed without session entries or process output.',
        };

  return (
    <LogRow lineNumber={null}>
      <LogContent className="text-foreground-contrast-secondary">
        <span className="inline-flex min-w-0 items-center gap-inline">
          <Icon name="info" className="size-14 flex-none" aria-hidden="true" />
          <span className="min-w-0">
            <span className="font-medium">{copy.title}</span>
            {' · '}
            <span className="text-foreground-contrast-secondary">{copy.detail}</span>
          </span>
        </span>
      </LogContent>
    </LogRow>
  );
}

function NoSearchMatchesRow({query}: {query: string}) {
  return (
    <LogRow lineNumber={null}>
      <LogContent className="text-foreground-contrast-secondary">
        <span className="inline-flex min-w-0 items-center gap-inline">
          <Icon name="searchLine" className="size-14 flex-none" aria-hidden="true" />
          <span>No log lines match “{query}”.</span>
        </span>
      </LogContent>
    </LogRow>
  );
}

function renderActivityNodes(
  nodes: readonly ActivityNode[],
  depth: number,
  tree: LogTree,
  defaultGroupsOpen: boolean,
  forceOpen: boolean,
  terminated: boolean,
  actionPresentation: ActionPresentationLookup | undefined,
  focusedActionSeq: number | null,
): ReactNode[] {
  return nodes.map((node): ReactNode => {
    switch (node.kind) {
      case 'output':
        return (
          <div key={node.seq} data-activity-anchor={node.seq}>
            <OutputLogRow record={node.record} lineNumber={node.lineNumber} indent={depth} />
          </div>
        );
      case 'group':
        return (
          <div key={node.seq} data-activity-anchor={node.seq}>
            <LogGroup
              node={node}
              depth={depth}
              terminated={terminated}
              defaultOpen={defaultGroupsOpen}
              forceOpen={forceOpen}
            >
              {renderActivityNodes(
                node.children,
                depth + 1,
                tree,
                defaultGroupsOpen,
                forceOpen,
                terminated,
                actionPresentation,
                focusedActionSeq,
              )}
            </LogGroup>
          </div>
        );
      case 'marker':
        return (
          <div key={node.seq} data-activity-anchor={node.seq}>
            <MarkerRow record={node.record} tree={tree} />
          </div>
        );
      case 'action':
        return (
          <div key={node.seq} data-activity-anchor={node.seq} data-activity-action={node.seq}>
            <ActivityActionRow
              action={node.action}
              indent={depth}
              terminated={terminated}
              forceOpen={forceOpen}
              presentation={resolveActionPresentation(node.action, actionPresentation)}
            />
          </div>
        );
      case 'read-group':
        return (
          <ActivityReadGroup
            key={node.seq}
            node={node}
            indent={depth}
            terminated={terminated}
            forceOpen={forceOpen}
            focusedActionSeq={focusedActionSeq}
            actionPresentation={actionPresentation}
          />
        );
      case 'session':
        return (
          <div key={node.seq} data-activity-anchor={node.seq}>
            <AgentSessionRows
              rows={[node.record.row]}
              lineNumber={node.lineNumber}
              resolvedToolCallIds={new Set()}
              toolCallNames={new Map()}
              indent={depth}
              forceOpen={forceOpen}
            />
          </div>
        );
      default:
        return assertNever(node);
    }
  });
}

function currentActivityAnchor(rows: HTMLElement, scrollElement: HTMLElement) {
  const viewport = scrollElement.getBoundingClientRect();
  const visible = Array.from(rows.querySelectorAll<HTMLElement>('[data-activity-anchor]')).filter(
    (element) => {
      if (element.getClientRects().length === 0) return false;
      const rect = element.getBoundingClientRect();
      return rect.bottom > viewport.top && rect.top < viewport.bottom;
    },
  );
  const anchor =
    visible.find((element) => element.getBoundingClientRect().top >= viewport.top) ??
    visible.at(-1);
  if (!anchor?.dataset.activityAnchor) return null;
  return {
    seq: anchor.dataset.activityAnchor,
    top: anchor.getBoundingClientRect().top,
    atTail: scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight <= 24,
  };
}

function scheduleAnimationFrame(callback: FrameRequestCallback): number {
  if (typeof globalThis.requestAnimationFrame === 'function') {
    return globalThis.requestAnimationFrame(callback);
  }
  return window.setTimeout(() => callback(Date.now()), 0);
}

function cancelScheduledFrame(frame: number) {
  if (typeof globalThis.cancelAnimationFrame === 'function') {
    globalThis.cancelAnimationFrame(frame);
    return;
  }
  window.clearTimeout(frame);
}

function isTerminalAttemptStatus(status: string | undefined): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled';
}

function MarkerRow({record, tree}: {record: MarkerLogRecord; tree: LogTree}): ReactNode {
  switch (record.type) {
    case 'end':
      return (
        <EndMarker
          record={record}
          lineCount={tree.lineCount}
          durationMs={tree.originTs != null ? record.ts - tree.originTs : null}
        />
      );
    case 'gap':
      return <GapMarker record={record} />;
    case 'capped':
      return <CappedMarker record={record} />;
    case 'timed_out':
      return <TimedOutMarker record={record} />;
    case 'run_cancelled':
      return <RunCancelledMarker record={record} />;
    case 'runner_lost':
      return <RunnerLostMarker record={record} />;
    default:
      return assertNever(record);
  }
}
