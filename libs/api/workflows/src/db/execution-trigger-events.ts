import {and, asc, inArray} from 'drizzle-orm';
import type {
  WorkflowExecutionEvent,
  WorkflowExecutionEventMetadata,
} from '#core/entities/job-execution.js';
import type {db, Tx} from './db.js';
import {normalizeListenerEvent} from './job-listener-events.js';
import type {JobExecutionDb} from './schema/job-executions.js';
import {jobListenerEvents} from './schema/job-listener-events.js';

/**
 * Loads canonical listener-event metadata without selecting payload data.
 *
 * The returned map has an entry for every requested execution so callers can
 * distinguish a metadata-only empty event list from a payload fallback.
 */
export async function loadJobExecutionsWithCanonicalTriggerEventMetadata(
  source: ReturnType<typeof db> | Tx,
  executions: readonly (JobExecutionDb | Omit<JobExecutionDb, 'triggerEvents'>)[],
): Promise<ReadonlyMap<string, WorkflowExecutionEventMetadata[]>> {
  const metadataByExecutionId = new Map(
    executions.map((execution) => [execution.id, [] as WorkflowExecutionEventMetadata[]]),
  );
  if (executions.length === 0) return metadataByExecutionId;

  const eventRows = await source
    .select({
      consumedByExecutionId: jobListenerEvents.consumedByExecutionId,
      eventRef: jobListenerEvents.eventRef,
      deliveryId: jobListenerEvents.deliveryId,
      source: jobListenerEvents.source,
      event: jobListenerEvents.event,
      disposition: jobListenerEvents.disposition,
      outcome: jobListenerEvents.outcome,
      outcomeReason: jobListenerEvents.outcomeReason,
      receivedAt: jobListenerEvents.receivedAt,
      triggerReference: jobListenerEvents.triggerReference,
      storedPayloadBytes: jobListenerEvents.storedPayloadBytes,
      normalizedEventBytes: jobListenerEvents.normalizedEventBytes,
    })
    .from(jobListenerEvents)
    .where(
      and(
        inArray(
          jobListenerEvents.consumedByExecutionId,
          executions.map((execution) => execution.id),
        ),
        inArray(jobListenerEvents.jobId, [
          ...new Set(executions.map((execution) => execution.jobId)),
        ]),
      ),
    )
    .orderBy(asc(jobListenerEvents.receivedAt), asc(jobListenerEvents.id));

  for (const eventRow of eventRows) {
    if (eventRow.consumedByExecutionId === null) continue;
    const metadata = metadataByExecutionId.get(eventRow.consumedByExecutionId);
    if (metadata === undefined) continue;
    metadata.push({
      event_ref: eventRow.eventRef,
      source: eventRow.source,
      event: eventRow.event,
      delivery_id: eventRow.deliveryId,
      received_at: eventRow.receivedAt.toISOString(),
      project: eventRow.triggerReference?.project ?? null,
      repository: eventRow.triggerReference?.repository ?? null,
      ref: eventRow.triggerReference?.ref ?? null,
      commit: eventRow.triggerReference?.commit ?? null,
      disposition: eventRow.disposition,
      outcome: eventRow.outcome,
      outcome_reason: eventRow.outcomeReason,
      stored_payload_bytes: eventRow.storedPayloadBytes,
      normalized_event_bytes: eventRow.normalizedEventBytes,
    });
  }

  return metadataByExecutionId;
}

/**
 * Hydrates execution rows from the canonical listener-event table.
 *
 * The legacy trigger-events array remains the fallback for executions retained
 * from before canonical event reads were deployed.
 */
export async function loadJobExecutionsWithCanonicalTriggerEvents(
  source: ReturnType<typeof db> | Tx,
  executions: readonly JobExecutionDb[],
): Promise<ReadonlyMap<string, JobExecutionDb>> {
  if (executions.length === 0) return new Map();

  const eventRows = await source
    .select()
    .from(jobListenerEvents)
    .where(
      and(
        inArray(
          jobListenerEvents.consumedByExecutionId,
          executions.map((execution) => execution.id),
        ),
        inArray(jobListenerEvents.jobId, [
          ...new Set(executions.map((execution) => execution.jobId)),
        ]),
      ),
    )
    .orderBy(asc(jobListenerEvents.receivedAt), asc(jobListenerEvents.id));
  const eventsByExecutionId = new Map<string, WorkflowExecutionEvent[]>();
  for (const eventRow of eventRows) {
    if (eventRow.consumedByExecutionId === null) continue;
    const events = eventsByExecutionId.get(eventRow.consumedByExecutionId) ?? [];
    events.push(normalizeListenerEvent(eventRow));
    eventsByExecutionId.set(eventRow.consumedByExecutionId, events);
  }

  return new Map(
    executions.map((execution) => {
      const canonicalEvents = eventsByExecutionId.get(execution.id);
      return [
        execution.id,
        canonicalEvents === undefined ? execution : {...execution, triggerEvents: canonicalEvents},
      ] as const;
    }),
  );
}
