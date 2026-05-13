import type {RunDto, RunStatusDto} from '@shipfox/api-workflows-dto';
import {Code, Text} from '@shipfox/react-ui';
import {humanDuration} from '#lib/human-duration.js';
import {RelativeTime} from '#lib/relative-time.js';
import {StatusDot, type StatusDotVariant} from './status-dot.js';

/**
 * Single Vercel-style row for a workflow run.
 *
 * Four zones at md+ (id+trigger / status+duration / workflow name / time)
 * collapse to a 2-line stack on sm. Rows are presentational only — no
 * click target until the run-detail surface ships (TODOS.md defers this).
 *
 *  md+:
 *  ┌─────────────┬──────────────────┬────────────────────────────┬───────────┐
 *  │ id8         │ ● running 12s    │ Workflow name (truncate)   │   3m ago  │
 *  │ manual      │                  │                            │           │
 *  └─────────────┴──────────────────┴────────────────────────────┴───────────┘
 *
 *  sm: status dot + name on row 1; id8 · trigger · time · duration on row 2.
 */

const TERMINAL_STATUSES = new Set<RunStatusDto>(['succeeded', 'failed', 'cancelled']);

const variantByStatus: Record<RunStatusDto, StatusDotVariant> = {
  pending: 'neutral',
  running: 'info',
  succeeded: 'success',
  failed: 'error',
  cancelled: 'neutral',
};

export function RunRow({run}: {run: RunDto}) {
  const isActive = !TERMINAL_STATUSES.has(run.status);
  const duration = humanDuration(run.created_at, isActive ? undefined : run.updated_at);
  const durationLabel = isActive && run.status === 'running' ? `running ${duration}` : duration;
  const shortId = run.id.slice(0, 8);

  return (
    <div
      // Presentational row. Not interactive in this PR (see TODOS.md
      // "Workflow run detail page"). No tabindex, no role=button — when
      // run-detail ships, swap to a Link and add the chevron.
      className="flex flex-col gap-6 px-12 py-10 transition-colors hover:bg-background-components-hover md:h-44 md:flex-row md:items-center md:gap-12 md:py-0"
    >
      <div className="flex shrink-0 flex-col gap-2 md:w-140">
        <Code variant="label" className="text-foreground-neutral-muted">
          {shortId}
        </Code>
        <Text size="xs" className="text-foreground-neutral-muted">
          {run.trigger_source}
        </Text>
      </div>

      <div className="flex shrink-0 items-center gap-6 md:w-140">
        <StatusDot variant={variantByStatus[run.status]} pulse={run.status === 'running'} />
        <Text size="xs" className="text-foreground-neutral-muted tabular-nums">
          {durationLabel}
        </Text>
      </div>

      <div className="min-w-0 flex-1">
        <Text size="sm" bold className="truncate">
          {run.name}
        </Text>
      </div>

      <div className="shrink-0 md:w-100 md:text-right">
        <Text size="xs" className="text-foreground-neutral-muted">
          <RelativeTime value={run.created_at} />
        </Text>
      </div>
    </div>
  );
}
