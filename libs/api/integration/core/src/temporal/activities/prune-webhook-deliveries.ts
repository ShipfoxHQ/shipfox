import {pruneWebhookDeliveries} from '#db/webhook-deliveries.js';
import {WEBHOOK_DELIVERY_RETENTION_DAYS} from '#temporal/constants.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export async function pruneWebhookDeliveriesActivity(): Promise<{deleted: number}> {
  const olderThan = new Date(Date.now() - WEBHOOK_DELIVERY_RETENTION_DAYS * MS_PER_DAY);
  return await pruneWebhookDeliveries({olderThan});
}
