import {randomUUID} from 'node:crypto';
import {sql} from 'drizzle-orm';
import {db} from '#db/db.js';
import {integrationsWebhookDeliveries} from '#db/schema/webhook-deliveries.js';
import {pruneWebhookDeliveriesActivity} from './prune-webhook-deliveries.js';

async function insertDelivery(deliveryId: string, receivedAt: Date): Promise<void> {
  await db()
    .insert(integrationsWebhookDeliveries)
    .values({provider: 'github', deliveryId, receivedAt});
}

describe('pruneWebhookDeliveriesActivity', () => {
  beforeEach(async () => {
    await db().execute(sql`TRUNCATE integrations_webhook_deliveries`);
  });

  it('deletes rows older than the retention window and keeps recent ones', async () => {
    const oldId = randomUUID();
    const recentId = randomUUID();
    const longAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await insertDelivery(oldId, longAgo);
    await insertDelivery(recentId, yesterday);

    const result = await pruneWebhookDeliveriesActivity();

    expect(result.deleted).toBe(1);
    const remaining = await db().select().from(integrationsWebhookDeliveries);
    expect(remaining.map((row) => row.deliveryId)).toEqual([recentId]);
  });

  it('returns zero deleted when nothing is past the retention window', async () => {
    await insertDelivery(randomUUID(), new Date());

    const result = await pruneWebhookDeliveriesActivity();

    expect(result.deleted).toBe(0);
  });
});
