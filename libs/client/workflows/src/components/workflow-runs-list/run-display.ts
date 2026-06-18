import type {RunDto} from '@shipfox/api-workflows-dto';

export function runTriggerLabel(run: RunDto): string {
  return [run.trigger_source, run.trigger_event].filter(Boolean).join(' / ');
}

export function runMatchesSearch(run: RunDto, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  const haystack = `${run.id} ${run.name} ${run.status} ${runTriggerLabel(run)}`.toLowerCase();
  return haystack.includes(needle);
}
