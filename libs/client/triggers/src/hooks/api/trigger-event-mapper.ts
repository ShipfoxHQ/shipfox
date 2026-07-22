import type {
  TriggerDecisionDto,
  TriggerEventDetailResponseDto,
  TriggerEventFacetItemDto,
  TriggerEventFacetsResponseDto,
  TriggerEventListItemDto,
  TriggerEventListResponseDto,
} from '@shipfox/api-triggers-dto';
import type {
  TriggerEventDetail,
  TriggerEventFacetItem,
  TriggerEventFacets,
  TriggerEventListPage,
  TriggerEventMatchedWorkflowResult,
  TriggerEventSummary,
} from '#core/trigger-event.js';

export function toTriggerEventSummary(event: TriggerEventListItemDto): TriggerEventSummary {
  return {
    id: event.id,
    eventRef: event.event_ref,
    origin: event.origin,
    workspaceId: event.workspace_id,
    provider: event.provider,
    source: event.source,
    event: event.event,
    deliveryId: event.delivery_id,
    connectionId: event.connection_id,
    outcome: event.outcome,
    matchedCount: event.matched_count,
    receivedAt: event.received_at,
    processedAt: event.processed_at,
    createdAt: event.created_at,
  };
}

export function toTriggerEventListPage(
  response: TriggerEventListResponseDto,
): TriggerEventListPage {
  return {
    events: response.trigger_events.map(toTriggerEventSummary),
    nextCursor: response.next_cursor,
  };
}

function toMatchedWorkflowResult(decision: TriggerDecisionDto): TriggerEventMatchedWorkflowResult {
  return {
    id: decision.id,
    subscriptionName: decision.subscription_name,
    decision: decision.decision,
    projectId: decision.project_id,
    runId: decision.run_id,
    runName: decision.run_name,
    reason: decision.reason,
  };
}

export function toTriggerEventDetail(response: TriggerEventDetailResponseDto): TriggerEventDetail {
  return {
    ...toTriggerEventSummary(response),
    connectionName: response.connection_name,
    payload: response.payload,
    decisions: response.decisions.map(toMatchedWorkflowResult),
  };
}

function toTriggerEventFacetItem(item: TriggerEventFacetItemDto): TriggerEventFacetItem {
  return {value: item.value, count: item.count};
}

export function toTriggerEventFacets(response: TriggerEventFacetsResponseDto): TriggerEventFacets {
  return {
    sources: response.sources.map(toTriggerEventFacetItem),
    events: response.events.map(toTriggerEventFacetItem),
  };
}
