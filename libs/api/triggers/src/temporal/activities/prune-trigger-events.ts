import {config} from '#config.js';
import {pruneTriggerEvents} from '#db/received-events.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export async function pruneTriggerEventsActivity(): Promise<{deleted: number}> {
  const olderThan = new Date(Date.now() - config.TRIGGER_EVENT_RETENTION_DAYS * MS_PER_DAY);
  return await pruneTriggerEvents({olderThan});
}
