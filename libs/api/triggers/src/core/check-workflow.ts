import type {ActionUploadDto, TriggerDto} from '@shipfox/api-definitions-dto';
import type {DefinitionsInterModuleClient} from '@shipfox/api-definitions-dto/inter-module';
import {getTriggerEventsByIds} from '#db/event-queries.js';
import {requireTrigger} from './create-dev-run.js';
import type {TriggerDecisionDiagnostic} from './entities/diagnostic.js';
import {CheckWorkflowEventIdsNotAllowedError} from './errors.js';
import {matchTriggerEvent} from './match-trigger-event.js';

export interface CheckWorkflowParams {
  definitions: Pick<DefinitionsInterModuleClient, 'validateDefinitionAtRef'>;
  workspaceId: string;
  projectId: string;
  ref?: string | undefined;
  content?: string | undefined;
  actions?: readonly ActionUploadDto[] | undefined;
  /** Commit the ref must still resolve to; a mismatch answers `ref-moved`. */
  commit?: string | undefined;
  configPath: string;
  /** Trigger key in the workflow file's `triggers` map. */
  triggerKey?: string | undefined;
  /** Journaled events to check against the trigger, in the order to report them. */
  eventIds?: readonly string[] | undefined;
}

export type CheckWorkflowEventResult =
  | 'matched'
  | 'filtered'
  | 'filter-error'
  | 'event-mismatch'
  | 'payload-unavailable'
  | 'not-found';

export const CHECK_WORKFLOW_EVENT_RESULTS = [
  'matched',
  'filtered',
  'filter-error',
  'event-mismatch',
  'payload-unavailable',
  'not-found',
] as const satisfies readonly CheckWorkflowEventResult[];

export interface CheckWorkflowEvent {
  eventId: string;
  result: CheckWorkflowEventResult;
  source?: string;
  event?: string;
  receivedAt?: Date;
  reason?: string;
  diagnostic?: TriggerDecisionDiagnostic;
}

type Validated = Awaited<ReturnType<DefinitionsInterModuleClient['validateDefinitionAtRef']>>;

export interface CheckWorkflowResult extends Validated {
  events?: CheckWorkflowEvent[];
  eventCounts?: Record<CheckWorkflowEventResult, number>;
}

/**
 * Validates a workflow file and checks journaled events against one of its
 * triggers, as dispatch would have handled them. Nothing is written: no
 * definition, no journal entry, no run.
 */
export async function checkWorkflow(params: CheckWorkflowParams): Promise<CheckWorkflowResult> {
  const validated = await params.definitions.validateDefinitionAtRef({
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    ...(params.ref === undefined ? {} : {ref: params.ref}),
    ...(params.content === undefined ? {} : {content: params.content}),
    ...(params.actions === undefined ? {} : {actions: [...params.actions]}),
    configPath: params.configPath,
    ...(params.commit === undefined ? {} : {expectedCommit: params.commit}),
  });
  if (!validated.valid || params.triggerKey === undefined) return validated;

  const trigger = requireTrigger(validated.triggers, params.triggerKey);
  if (params.eventIds === undefined) return validated;
  if (trigger.source === 'manual' || trigger.source === 'cron') {
    throw new CheckWorkflowEventIdsNotAllowedError(trigger.source);
  }

  const events = await checkEvents({
    trigger,
    workspaceId: params.workspaceId,
    eventIds: params.eventIds,
  });
  return {...validated, events, eventCounts: countResults(events)};
}

async function checkEvents(params: {
  trigger: TriggerDto;
  workspaceId: string;
  eventIds: readonly string[];
}): Promise<CheckWorkflowEvent[]> {
  const rows = await getTriggerEventsByIds(params.eventIds);
  // A row in another workspace answers like a missing one, so ids do not leak existence.
  const byId = new Map(
    rows.filter((row) => row.workspaceId === params.workspaceId).map((row) => [row.id, row]),
  );

  return params.eventIds.map((eventId): CheckWorkflowEvent => {
    const row = byId.get(eventId);
    if (row === undefined) return {eventId, result: 'not-found'};

    const match = matchTriggerEvent({trigger: params.trigger, event: row});
    const base = {
      eventId,
      result: match.result,
      source: row.source,
      event: row.event,
      receivedAt: row.receivedAt,
    };
    return match.result === 'filter-error'
      ? {...base, reason: match.reason, diagnostic: match.diagnostic}
      : base;
  });
}

function countResults(events: readonly CheckWorkflowEvent[]) {
  const counts = Object.fromEntries(
    CHECK_WORKFLOW_EVENT_RESULTS.map((result) => [result, 0]),
  ) as Record<CheckWorkflowEventResult, number>;
  for (const event of events) counts[event.result] += 1;
  return counts;
}
