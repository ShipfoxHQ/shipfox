import type {RunStatusDto} from '@shipfox/api-workflows-dto';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Icon,
  Text,
} from '@shipfox/react-ui';
import {workflowStatusVisual} from '#lib/workflow-status-visual.js';
import {StatusDot} from './status-dot.js';

/**
 * Vercel-style status filter dropdown.
 *
 * Replaces the segmented pill row. Trigger reads `Status` (none) or
 * `Status 1/5` (one selected). Each option shows the count from the
 * aggregates query. Single-select for now — backend `status` query
 * param accepts one value (multi-select is a filed follow-up).
 *
 * Footer surfaces a Retry affordance when aggregate counts errored;
 * the filter itself still works without counts.
 */

const RUN_STATUSES: RunStatusDto[] = ['pending', 'running', 'succeeded', 'failed', 'cancelled'];

export function RunStatusFilter({
  value,
  counts,
  countsUnavailable,
  onChange,
  onRetryCounts,
}: {
  value: RunStatusDto | undefined;
  counts: Array<{value: RunStatusDto; count: number}>;
  countsUnavailable: boolean;
  onChange: (next: RunStatusDto | undefined) => void;
  onRetryCounts: () => void;
}) {
  const countByStatus = new Map(counts.map((bucket) => [bucket.value, bucket.count]));
  const selectedCount = value ? 1 : 0;
  const triggerLabel = value ? `Status ${selectedCount}/5` : 'Status';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="secondary"
          aria-label={
            value ? `Status filter, 1 of 5 selected (${value})` : 'Status filter, none selected'
          }
        >
          <span className="inline-flex items-center gap-6">
            {value ? <StatusDot variant={workflowStatusVisual(value).dot} /> : null}
            <Text size="sm">{triggerLabel}</Text>
            <Icon name="arrowDownSLine" className="size-14 text-foreground-neutral-muted" />
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" size="md">
        <DropdownMenuItem onSelect={() => onChange(undefined)} aria-label="Show all run statuses">
          <span className="flex w-full items-center justify-between gap-12">
            <span className="inline-flex items-center gap-8">
              <Icon
                name={value === undefined ? 'check' : 'subtractLine'}
                className={
                  value === undefined
                    ? 'size-14 text-foreground-neutral-base'
                    : 'size-14 text-transparent'
                }
              />
              <Text size="sm">Any status</Text>
            </span>
          </span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {RUN_STATUSES.map((status) => {
          const count = countByStatus.get(status);
          const isSelected = value === status;
          return (
            <DropdownMenuItem
              key={status}
              onSelect={() => onChange(isSelected ? undefined : status)}
              aria-label={`Filter runs by ${status}`}
            >
              <span className="flex w-full items-center justify-between gap-12">
                <span className="inline-flex items-center gap-8">
                  <Icon
                    name={isSelected ? 'check' : 'subtractLine'}
                    className={
                      isSelected
                        ? 'size-14 text-foreground-neutral-base'
                        : 'size-14 text-transparent'
                    }
                  />
                  <StatusDot variant={workflowStatusVisual(status).dot} />
                  <Text size="sm">{status}</Text>
                </span>
                {countsUnavailable ? null : (
                  <Text size="xs" className="text-foreground-neutral-muted tabular-nums">
                    {count ?? 0}
                  </Text>
                )}
              </span>
            </DropdownMenuItem>
          );
        })}
        {countsUnavailable ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem closeOnSelect={false} onSelect={() => onRetryCounts()}>
              <span className="inline-flex items-center gap-6">
                <Icon name="refreshLine" className="size-14 text-foreground-neutral-muted" />
                <Text size="xs" className="text-foreground-neutral-muted">
                  Counts unavailable, retry
                </Text>
              </span>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
