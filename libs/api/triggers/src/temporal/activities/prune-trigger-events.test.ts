import {randomUUID} from 'node:crypto';
import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {triggersDecisions} from '#db/schema/decisions.js';
import {triggersReceivedEvents} from '#db/schema/received-events.js';
import {pruneTriggerEventsActivity} from './prune-trigger-events.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// The prune is global in a shared test DB, so assert by id instead of truncating.
async function insertEvent(createdAt: Date): Promise<string> {
  const id = randomUUID();
  await db().insert(triggersReceivedEvents).values({
    id,
    eventRef: randomUUID(),
    origin: 'integration',
    workspaceId: randomUUID(),
    source: 'github',
    event: 'push',
    receivedAt: createdAt,
    createdAt,
  });
  return id;
}

async function insertDecision(receivedEventId: string): Promise<string> {
  const id = randomUUID();
  await db().insert(triggersDecisions).values({
    id,
    receivedEventId,
    subscriptionId: randomUUID(),
    workflowDefinitionId: randomUUID(),
    projectId: randomUUID(),
    decision: 'triggered',
  });
  return id;
}

async function eventExists(id: string): Promise<boolean> {
  const rows = await db()
    .select({id: triggersReceivedEvents.id})
    .from(triggersReceivedEvents)
    .where(eq(triggersReceivedEvents.id, id));
  return rows.length > 0;
}

async function decisionExists(id: string): Promise<boolean> {
  const rows = await db()
    .select({id: triggersDecisions.id})
    .from(triggersDecisions)
    .where(eq(triggersDecisions.id, id));
  return rows.length > 0;
}

describe('pruneTriggerEventsActivity', () => {
  it('deletes events older than the retention window and cascades their decisions', async () => {
    const oldId = await insertEvent(new Date(Date.now() - 60 * DAY_MS));
    const decisionId = await insertDecision(oldId);
    const recentId = await insertEvent(new Date(Date.now() - DAY_MS));

    const result = await pruneTriggerEventsActivity();

    expect(result.deleted).toBeGreaterThanOrEqual(1);
    expect(await eventExists(oldId)).toBe(false);
    expect(await decisionExists(decisionId)).toBe(false);
    expect(await eventExists(recentId)).toBe(true);
  });

  it('keeps events within the retention window', async () => {
    const recentId = await insertEvent(new Date(Date.now() - DAY_MS));

    await pruneTriggerEventsActivity();

    expect(await eventExists(recentId)).toBe(true);
  });
});
