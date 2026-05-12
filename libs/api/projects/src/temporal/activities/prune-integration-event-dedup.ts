import {pruneIntegrationEventDedup} from '#db/integration-event-dedup.js';
import {INTEGRATION_EVENT_DEDUP_RETENTION_DAYS} from '#temporal/constants.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export async function pruneIntegrationEventDedupActivity(): Promise<{deleted: number}> {
  const olderThan = new Date(Date.now() - INTEGRATION_EVENT_DEDUP_RETENTION_DAYS * MS_PER_DAY);
  return await pruneIntegrationEventDedup({olderThan});
}
