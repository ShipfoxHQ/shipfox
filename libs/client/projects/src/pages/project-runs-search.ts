import type {RunStatusDto} from '@shipfox/api-workflows-dto';
import {isAlnumSlug, isUuid} from '@shipfox/regex';
import type {WorkflowRunFilters} from '#hooks/api/workflow-runs.js';

const RUN_STATUSES: RunStatusDto[] = ['pending', 'running', 'succeeded', 'failed', 'cancelled'];
const DATE_PRESETS = ['all', '24h', '7d', '30d'] as const;
// trigger_source is open-ended on the API; the URL sanitiser just keeps it well-formed.
const TRIGGER_SOURCE_MAX_LENGTH = 64;

export type DatePreset = (typeof DATE_PRESETS)[number];

export interface RunsSearchState {
  status?: RunStatusDto | undefined;
  definitionId?: string | undefined;
  triggerSource?: string | undefined;
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
    typeof search.trigger_source === 'string' && isTriggerSource(search.trigger_source)
      ? search.trigger_source
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

function isTriggerSource(value: string) {
  return value.length > 0 && value.length <= TRIGGER_SOURCE_MAX_LENGTH && isAlnumSlug(value);
}
