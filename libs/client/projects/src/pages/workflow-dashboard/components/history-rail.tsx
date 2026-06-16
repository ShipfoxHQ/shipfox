import {Button, Code, cn, Icon, Text} from '@shipfox/react-ui';
import {useMemo, useState} from 'react';
import {formatDuration, formatRelativeTime} from '../lib/workflow-dashboard-format.js';
import {workflowStatusBorderClass} from '../lib/workflow-dashboard-status.js';
import type {WorkflowDashboardRun} from '../workflow-dashboard-types.js';
import {StatusDot, WorkflowStatusBadge} from './status-badge.js';

type HistoryFilter = 'all' | 'failed' | 'running';

export function HistoryRail({
  onCollapse,
  onSelect,
  runKey,
  runOrder,
  runs,
}: {
  onCollapse: () => void;
  onSelect: (key: string) => void;
  runKey: string;
  runOrder: string[];
  runs: Record<string, WorkflowDashboardRun>;
}) {
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [query, setQuery] = useState('');
  const visibleRuns = useMemo(
    () =>
      runOrder.flatMap((key) => {
        const run = runs[key];
        if (!run) return [];
        if (filter === 'failed' && run.status !== 'failed') return [];
        if (filter === 'running' && run.status !== 'running') return [];
        const haystack = `#${run.number} ${run.trigger.incident}`.toLowerCase();
        if (query && !haystack.includes(query.toLowerCase())) return [];
        return [{key, run}];
      }),
    [filter, query, runOrder, runs],
  );

  return (
    <aside className="flex min-w-0 flex-1 flex-col overflow-y-auto border-border-neutral-base border-r bg-background-components-base">
      <div className="sticky top-0 z-10 border-border-neutral-base border-b bg-background-components-base px-12 pt-14 pb-10">
        <div className="mb-10 flex items-center justify-between">
          <Text
            as="span"
            size="xs"
            bold
            className="uppercase tracking-[0.06em] text-foreground-neutral-muted"
          >
            Runs
          </Text>
          <Button
            aria-label="Collapse runs panel"
            iconLeft="arrowLeftDoubleLine"
            onClick={onCollapse}
            size="xs"
            variant="transparentMuted"
          />
        </div>
        <label className="mb-8 flex h-28 items-center gap-6 rounded-6 border border-border-neutral-base bg-background-field-base px-8 text-foreground-neutral-muted">
          <Icon name="searchLine" className="size-14" />
          <input
            className="min-w-0 flex-1 bg-transparent text-foreground-neutral-base text-sm outline-none placeholder:text-foreground-neutral-muted"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Run id or trigger..."
            value={query}
          />
        </label>
        <div className="flex gap-4">
          {[
            {label: 'All', value: 'all'},
            {label: 'Failed', value: 'failed'},
            {label: 'Running', value: 'running'},
          ].map((item) => (
            <button
              className={cn(
                'h-24 rounded-4 border border-transparent px-7 text-foreground-neutral-muted text-xs font-medium hover:bg-background-components-hover hover:text-foreground-neutral-base focus-visible:shadow-button-neutral-focus focus-visible:outline-none',
                filter === item.value &&
                  'border-tag-warning-border bg-background-highlight-base text-foreground-highlight-interactive',
              )}
              key={item.value}
              onClick={() => setFilter(item.value as HistoryFilter)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-4 p-6">
        {visibleRuns.map(({key, run}) => (
          <button
            className={cn(
              'relative flex flex-col gap-6 rounded-8 border border-transparent px-10 py-9 text-left hover:bg-background-components-hover focus-visible:shadow-button-neutral-focus focus-visible:outline-none',
              runKey === key &&
                'border-tag-warning-border bg-background-highlight-base before:absolute before:top-8 before:bottom-8 before:left-0 before:w-3 before:rounded-full before:bg-background-highlight-interactive before:content-[""]',
              workflowStatusBorderClass(run.status),
            )}
            key={key}
            onClick={() => onSelect(key)}
            type="button"
          >
            <div className="flex items-center gap-7">
              <StatusDot pulse status={run.status} />
              <Code as="span" variant="paragraph" bold>
                #{run.number}
              </Code>
              <WorkflowStatusBadge status={run.status} />
              <span className="flex-1" />
              <Code as="span" variant="label" className="text-foreground-neutral-muted">
                {formatDuration(run.duration)}
                {run.status === 'running' ? '...' : ''}
              </Code>
            </div>
            <div className="flex items-center gap-6">
              <Icon name="sentry" className="size-12 text-foreground-neutral-muted" />
              <Code as="span" variant="label" className="text-foreground-neutral-subtle">
                {run.trigger.incident}
              </Code>
              <span className="flex-1" />
              <Code as="span" variant="label" className="text-foreground-neutral-disabled">
                {formatRelativeTime(run.observedUntil, previewNowIso)}
              </Code>
            </div>
          </button>
        ))}
      </div>
    </aside>
  );
}

export function CollapsedHistoryRail({count, onExpand}: {count: number; onExpand: () => void}) {
  return (
    <div className="flex w-full flex-col items-center gap-12 border-border-neutral-base border-r bg-background-components-base py-10">
      <Button
        aria-label="Show runs"
        iconLeft="panelRightLine"
        onClick={onExpand}
        size="sm"
        variant="secondary"
      />
      <div className="flex items-center gap-8 [writing-mode:vertical-rl]">
        <Text
          as="span"
          size="xs"
          bold
          className="uppercase tracking-[0.06em] text-foreground-neutral-muted"
        >
          Runs
        </Text>
        <Code as="span" variant="label" className="text-foreground-neutral-subtle">
          {count}
        </Code>
      </div>
    </div>
  );
}

const previewNowIso = '2026-06-12T12:10:00Z';
