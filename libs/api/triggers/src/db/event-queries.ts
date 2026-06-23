import {paginateTimestampIdRows, timestampIdCursorWhere} from '@shipfox/node-drizzle';
import {and, asc, desc, eq, gte, inArray, lte, type SQL} from 'drizzle-orm';
import type {TriggerDecision} from '#core/entities/decision.js';
import type {
  TriggerEventOutcome,
  TriggerReceivedEvent,
  TriggerReceivedEventSummary,
} from '#core/entities/received-event.js';
import {db} from './db.js';
import {toTriggerDecision, triggersDecisions} from './schema/decisions.js';
import {
  toTriggerReceivedEvent,
  toTriggerReceivedEventSummary,
  triggerReceivedEventSummaryColumns,
  triggersReceivedEvents,
} from './schema/received-events.js';

export interface TriggerEventCursor {
  receivedAt: Date;
  id: string;
}

export interface TriggerEventListFilters {
  source?: string | undefined;
  event?: string | undefined;
  outcomes?: TriggerEventOutcome[] | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
}

export interface ListTriggerEventsParams {
  workspaceId: string;
  limit: number;
  cursor?: TriggerEventCursor | undefined;
  filters?: TriggerEventListFilters | undefined;
}

export interface ListTriggerEventsResult {
  events: TriggerReceivedEventSummary[];
  nextCursor: TriggerEventCursor | null;
}

function listConditions(params: ListTriggerEventsParams): SQL[] {
  const {workspaceId, cursor, filters} = params;
  const conditions: SQL[] = [eq(triggersReceivedEvents.workspaceId, workspaceId)];
  const cursorCondition = timestampIdCursorWhere({
    timestampColumn: triggersReceivedEvents.receivedAt,
    idColumn: triggersReceivedEvents.id,
    cursor: cursor ? {createdAt: cursor.receivedAt, id: cursor.id} : undefined,
  });
  if (cursorCondition) conditions.push(cursorCondition);
  if (filters?.source) conditions.push(eq(triggersReceivedEvents.source, filters.source));
  if (filters?.event) conditions.push(eq(triggersReceivedEvents.event, filters.event));
  if (filters?.outcomes?.length)
    conditions.push(inArray(triggersReceivedEvents.outcome, filters.outcomes));
  if (filters?.from) conditions.push(gte(triggersReceivedEvents.receivedAt, filters.from));
  if (filters?.to) conditions.push(lte(triggersReceivedEvents.receivedAt, filters.to));
  return conditions;
}

export async function listTriggerEvents(
  params: ListTriggerEventsParams,
): Promise<ListTriggerEventsResult> {
  const rows = await db()
    .select(triggerReceivedEventSummaryColumns)
    .from(triggersReceivedEvents)
    .where(and(...listConditions(params)))
    .orderBy(desc(triggersReceivedEvents.receivedAt), desc(triggersReceivedEvents.id))
    .limit(params.limit + 1);

  const page = paginateTimestampIdRows({rows, limit: params.limit, timestampKey: 'receivedAt'});

  return {
    events: page.pageRows.map(toTriggerReceivedEventSummary),
    nextCursor: page.nextCursor
      ? {receivedAt: page.nextCursor.createdAt, id: page.nextCursor.id}
      : null,
  };
}

export async function getTriggerEventById(id: string): Promise<TriggerReceivedEvent | undefined> {
  const [row] = await db()
    .select()
    .from(triggersReceivedEvents)
    .where(eq(triggersReceivedEvents.id, id))
    .limit(1);
  return row ? toTriggerReceivedEvent(row) : undefined;
}

// `received_event_id` is a globally-unique uuid, so the parent-event lookup is the
// workspace gate; the decision query needs no separate workspace predicate.
export async function listDecisionsByReceivedEventId(
  receivedEventId: string,
): Promise<TriggerDecision[]> {
  const rows = await db()
    .select()
    .from(triggersDecisions)
    .where(eq(triggersDecisions.receivedEventId, receivedEventId))
    .orderBy(asc(triggersDecisions.createdAt), asc(triggersDecisions.id));
  return rows.map(toTriggerDecision);
}
