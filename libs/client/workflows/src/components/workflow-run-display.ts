import type {RunDto} from '@shipfox/api-workflows-dto';

export function runTriggerLabel(run: RunDto): string {
  return [run.trigger_source, run.trigger_event].filter(Boolean).join(' / ');
}
