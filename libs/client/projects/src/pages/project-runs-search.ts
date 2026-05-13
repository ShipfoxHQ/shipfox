import type {RunStatusDto, TriggerSourceDto} from '@shipfox/api-workflows-dto';
import type {WorkflowRunFilters} from '#hooks/api/workflow-runs.js';

const RUN_STATUSES: RunStatusDto[] = ['pending', 'running', 'succeeded', 'failed', 'cancelled'];
const TRIGGER_SOURCES: TriggerSourceDto[] = ['manual', 'webhook', 'schedule'];
const DATE_PRESETS = ['all', '24h', '7d', '30d'] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DatePreset = (typeof DATE_PRESETS)[number];

export interface RunsSearchState {
  status?: RunStatusDto | undefined;
  definitionId?: string | undefined;
  triggerSource?: TriggerSourceDto | undefined;
  date: DatePreset;
}

export function sanitizeRunsSearch(search: Record<string, unknown>): RunsSearchState {
  const status =
    typeof search.status === 'string' && RUN_STATUSES.includes(search.status as RunStatusDto)
      ? (search.status as RunStatusDto)
      : undefined;
  const definitionId =
    typeof search.definition_id === 'string' && isUuid(search.definition_id)
      ? search.definition_id
      : undefined;
  const triggerSource =
    typeof search.trigger_source === 'string' &&
    TRIGGER_SOURCES.includes(search.trigger_source as TriggerSourceDto)
      ? (search.trigger_source as TriggerSourceDto)
      : undefined;
  const date =
    typeof search.date === 'string' && DATE_PRESETS.includes(search.date as DatePreset)
      ? (search.date as DatePreset)
      : 'all';

  return {status, definitionId, triggerSource, date};
}

export function serializeRunsSearch(search: RunsSearchState) {
  return {
    ...(search.status ? {status: search.status} : {}),
    ...(search.definitionId ? {definition_id: search.definitionId} : {}),
    ...(search.triggerSource ? {trigger_source: search.triggerSource} : {}),
    ...(search.date !== 'all' ? {date: search.date} : {}),
  };
}

export function sameSearch(current: Record<string, unknown>, normalized: Record<string, string>) {
  const currentKeys = Object.keys(current).filter((key) => current[key] !== undefined);
  const normalizedKeys = Object.keys(normalized);
  if (currentKeys.length !== normalizedKeys.length) return false;

  return normalizedKeys.every((key) => current[key] === normalized[key]);
}

export function toWorkflowRunFilters(search: RunsSearchState): WorkflowRunFilters {
  const windowMsByPreset: Partial<Record<DatePreset, number>> = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
  };
  const windowMs = windowMsByPreset[search.date];
  return {
    status: search.status,
    definitionId: search.definitionId,
    triggerSource: search.triggerSource,
    createdFrom: windowMs ? new Date(Date.now() - windowMs).toISOString() : undefined,
  };
}

function isUuid(value: string) {
  return UUID_RE.test(value);
}
