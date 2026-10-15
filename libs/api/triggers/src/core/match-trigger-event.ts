import type {TriggerDto} from '@shipfox/api-definitions-dto';
import {SHIPFOX_PROVIDER} from '@shipfox/api-integration-shipfox-dto';
import {workflowRunUrl} from '@shipfox/api-workflows-dto';
import {config as triggersConfig} from '#config.js';
import {evaluateTriggerFilter, type TriggerFilterEvaluation} from './config.js';
import type {TriggerDecisionDiagnostic} from './entities/diagnostic.js';
import type {TriggerReceivedEvent} from './entities/received-event.js';

/** A journaled integration event with everything a replay needs. */
export interface ReplayableTriggerEvent extends TriggerReceivedEvent {
  provider: string;
  deliveryId: string;
  payload: Record<string, unknown>;
}

export type TriggerEventMatch =
  | {result: 'matched'; event: ReplayableTriggerEvent}
  | {result: 'filtered'; event: ReplayableTriggerEvent}
  | {
      result: 'filter-error';
      event: ReplayableTriggerEvent;
      reason: string;
      diagnostic: TriggerDecisionDiagnostic;
    }
  | {result: 'event-mismatch'; event: TriggerReceivedEvent}
  | {result: 'payload-unavailable'; event: TriggerReceivedEvent};

/**
 * Decides whether a trigger would have started a run for a journaled event.
 * The source and event rules match the subscription query that dispatch runs,
 * and the filter is evaluated exactly as dispatch evaluates it, failing closed.
 */
export function matchTriggerEvent(params: {
  trigger: TriggerDto;
  event: TriggerReceivedEvent;
}): TriggerEventMatch {
  const {trigger, event} = params;
  if (
    event.origin !== 'integration' ||
    event.source !== trigger.source ||
    (trigger.event !== undefined && event.event !== trigger.event)
  ) {
    return {result: 'event-mismatch', event};
  }
  // Integration rows always carry provider and delivery id (dispatch requires
  // them); a pruned payload is the expected unavailability.
  if (event.payload === null || event.provider === null || event.deliveryId === null) {
    return {result: 'payload-unavailable', event};
  }

  const replayable: ReplayableTriggerEvent = {
    ...event,
    provider: event.provider,
    deliveryId: event.deliveryId,
    payload: withRunUrl(event.provider, event.payload),
  };
  const evaluation: TriggerFilterEvaluation = evaluateTriggerFilter({
    subscription: {config: {filter: trigger.filter}},
    source: replayable.source,
    event: replayable.event,
    payload: replayable.payload,
  });
  switch (evaluation.kind) {
    case 'matched':
      return {result: 'matched', event: replayable};
    case 'filtered':
      return {result: 'filtered', event: replayable};
    case 'filter-error':
      return {
        result: 'filter-error',
        event: replayable,
        reason: evaluation.reason,
        diagnostic: evaluation.diagnostic,
      };
  }
}

// Shipfox events stored before `run.url` existed replay with the link a new event would carry.
function withRunUrl(provider: string, payload: Record<string, unknown>): Record<string, unknown> {
  if (provider !== SHIPFOX_PROVIDER) return payload;
  const run = payload.run;
  if (typeof run !== 'object' || run === null || Array.isArray(run)) return payload;
  const {id, url} = run as {id?: unknown; url?: unknown};
  if (typeof id !== 'string' || url !== undefined) return payload;
  return {
    ...payload,
    run: {...run, url: workflowRunUrl({clientBaseUrl: triggersConfig.CLIENT_BASE_URL, runId: id})},
  };
}
