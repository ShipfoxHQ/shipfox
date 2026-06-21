import type {RunDto, RunStatusDto} from '@shipfox/api-workflows-dto';
import type {RunsListStatusFilter} from './types.js';

export function runTriggerLabel(run: RunDto): string {
  return [run.trigger_source, run.trigger_event].filter(Boolean).join(' / ');
}

export function runMatchesSearch(run: RunDto, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  const haystack = `${run.id} ${run.name} ${run.status} ${runTriggerLabel(run)}`.toLowerCase();
  return haystack.includes(needle);
}

const IN_PROGRESS_STATUSES: ReadonlySet<RunStatusDto> = new Set(['pending', 'running']);

export function runMatchesStatusFilter(
  status: RunStatusDto,
  filter: RunsListStatusFilter,
): boolean {
  if (filter === 'all') return true;
  // "Running" reads as in-progress: it covers freshly-queued `pending` runs (including the
  // optimistic manual run inserted on fire) so they are not hidden the moment the filter is on.
  if (filter === 'running') return IN_PROGRESS_STATUSES.has(status);
  return status === filter;
}
