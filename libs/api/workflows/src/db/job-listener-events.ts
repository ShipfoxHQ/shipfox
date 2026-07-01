import {eq} from 'drizzle-orm';
import {isJobTerminal} from '#core/entities/job.js';
import type {JobListenerEventDisposition} from '#core/entities/job-listener-event.js';
import {recordListenerEventReceived} from '#metrics/instance.js';
import {db} from './db.js';
import {jobListenerEvents} from './schema/job-listener-events.js';
import {jobs} from './schema/jobs.js';

export interface DeliverEventToListenerParams {
  jobId: string;
  disposition: JobListenerEventDisposition;
  eventRef: string;
  deliveryId: string;
  source: string;
  event: string;
  provider: string;
  payload: unknown;
  receivedAt: Date;
}

export interface DeliverEventToListenerResult {
  buffered: boolean;
  skipped: boolean;
}

export async function deliverEventToListener(
  params: DeliverEventToListenerParams,
): Promise<DeliverEventToListenerResult> {
  const [job] = await db()
    .select({id: jobs.id, status: jobs.status})
    .from(jobs)
    .where(eq(jobs.id, params.jobId))
    .limit(1);

  if (!job || isJobTerminal(job.status)) return {buffered: false, skipped: true};

  const rows = await db()
    .insert(jobListenerEvents)
    .values({
      jobId: params.jobId,
      disposition: params.disposition,
      eventRef: params.eventRef,
      deliveryId: params.deliveryId,
      source: params.source,
      event: params.event,
      payload: params.payload,
      receivedAt: params.receivedAt,
    })
    .onConflictDoNothing({target: [jobListenerEvents.jobId, jobListenerEvents.eventRef]})
    .returning();

  const row = rows[0];
  if (!row) return {buffered: false, skipped: false};

  recordListenerEventReceived(params.provider);
  return {buffered: true, skipped: false};
}
