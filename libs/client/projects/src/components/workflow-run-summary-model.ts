import type {RunDto, RunStatusDto} from '@shipfox/api-workflows-dto';
import type {IconName} from '@shipfox/react-ui';
import type {StatusDotVariant} from './status-dot.js';

export type WorkflowRunSummaryRun = Pick<
  RunDto,
  | 'created_at'
  | 'definition_id'
  | 'id'
  | 'inputs'
  | 'name'
  | 'project_id'
  | 'status'
  | 'trigger_event'
  | 'trigger_payload'
  | 'trigger_source'
  | 'updated_at'
>;

export interface WorkflowRunSummaryModel {
  id: string;
  shortId: string;
  name: string;
  status: RunStatusDto;
  statusLabel: string;
  statusVariant: StatusVariant;
  dotVariant: StatusDotVariant;
  triggerLabel: string;
  triggerPayloadLabel: string | null;
  triggerIcon: IconName;
  createdAt: string;
  updatedAt: string;
}

type StatusVariant = 'neutral' | 'info' | 'success' | 'error';

const statusByRunStatus: Record<
  RunStatusDto,
  {label: string; statusVariant: StatusVariant; dotVariant: StatusDotVariant}
> = {
  pending: {label: 'Pending', statusVariant: 'neutral', dotVariant: 'neutral'},
  running: {label: 'Running', statusVariant: 'info', dotVariant: 'info'},
  succeeded: {label: 'Succeeded', statusVariant: 'success', dotVariant: 'success'},
  failed: {label: 'Failed', statusVariant: 'error', dotVariant: 'error'},
  cancelled: {label: 'Cancelled', statusVariant: 'neutral', dotVariant: 'neutral'},
};

const triggerIconBySource: Record<string, IconName> = {
  github: 'github',
  sentry: 'sentry',
  slack: 'slack',
};

export function toWorkflowRunSummary(run: WorkflowRunSummaryRun): WorkflowRunSummaryModel {
  const status = statusByRunStatus[run.status];
  return {
    id: run.id,
    shortId: run.id.slice(0, 8),
    name: run.name,
    status: run.status,
    statusLabel: status.label,
    statusVariant: status.statusVariant,
    dotVariant: status.dotVariant,
    triggerLabel: formatTriggerLabel(run.trigger_source, run.trigger_event),
    triggerPayloadLabel: summarizeTriggerPayload(run.trigger_payload),
    triggerIcon: triggerIconName(run.trigger_source),
    createdAt: run.created_at,
    updatedAt: run.updated_at,
  };
}

function formatTriggerLabel(source: string, event: string) {
  const cleanSource = source.trim();
  const cleanEvent = event.trim();

  if (!cleanSource && !cleanEvent) return 'unknown trigger';
  if (!cleanEvent) return cleanSource;
  if (!cleanSource) return cleanEvent;
  return `${cleanSource} · ${cleanEvent}`;
}

function triggerIconName(source: string): IconName {
  const icon = triggerIconBySource[source.trim().toLowerCase()];
  return icon ?? 'pulseLine';
}

function summarizeTriggerPayload(payload: Record<string, unknown>) {
  const fieldCount = Object.keys(payload).length;
  if (fieldCount === 0) return null;
  return `${fieldCount} payload ${fieldCount === 1 ? 'field' : 'fields'}`;
}
