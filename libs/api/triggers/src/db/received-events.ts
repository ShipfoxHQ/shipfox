import {lt} from 'drizzle-orm';
import {db} from './db.js';
import {triggersReceivedEvents} from './schema/received-events.js';

export interface PruneTriggerEventsParams {
  olderThan: Date;
}

export async function pruneTriggerEvents(
  params: PruneTriggerEventsParams,
): Promise<{deleted: number}> {
  const result = await db()
    .delete(triggersReceivedEvents)
    .where(lt(triggersReceivedEvents.createdAt, params.olderThan));
  return {deleted: result.rowCount ?? 0};
}
