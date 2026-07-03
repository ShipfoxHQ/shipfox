import {randomUUID} from 'node:crypto';
import {inArray} from 'drizzle-orm';
import {db} from '#db/db.js';
import {projectsIntegrationEventDedup} from '#db/schema/integration-event-dedup.js';
import {pruneIntegrationEventDedupActivity} from './prune-integration-event-dedup.js';

async function insertDedupRow(receivedAt: Date): Promise<{
  integrationEventId: string;
  projectId: string;
}> {
  const integrationEventId = randomUUID();
  const projectId = randomUUID();
  await db()
    .insert(projectsIntegrationEventDedup)
    .values({integrationEventId, projectId, receivedAt});
  return {integrationEventId, projectId};
}

describe('pruneIntegrationEventDedupActivity', () => {
  it('deletes rows older than the retention window and keeps recent ones', async () => {
    const longAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const old = await insertDedupRow(longAgo);
    const recent = await insertDedupRow(yesterday);

    const result = await pruneIntegrationEventDedupActivity();

    expect(result.deleted).toBe(1);
    const remaining = await db()
      .select()
      .from(projectsIntegrationEventDedup)
      .where(
        inArray(projectsIntegrationEventDedup.integrationEventId, [
          old.integrationEventId,
          recent.integrationEventId,
        ]),
      );
    expect(remaining.map((row) => row.integrationEventId)).toEqual([recent.integrationEventId]);
    expect(remaining.map((row) => row.projectId)).toEqual([recent.projectId]);
    expect(old.integrationEventId).not.toEqual(recent.integrationEventId);
  });

  it('returns zero deleted when nothing is past the retention window', async () => {
    await insertDedupRow(new Date());

    const result = await pruneIntegrationEventDedupActivity();

    expect(result.deleted).toBe(0);
  });
});
