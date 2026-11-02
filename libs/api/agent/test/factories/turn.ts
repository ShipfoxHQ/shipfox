import {Factory} from 'fishery';
import type {AgentTurn} from '#core/entities/conversation.js';
import {db} from '#db/db.js';
import {toAgentTurn, turns} from '#db/schema/turns.js';

export const turnFactory = Factory.define<AgentTurn>(({onCreate}) => {
  onCreate(async (turn) => {
    const rows = await db().insert(turns).values(turn).returning();
    const [row] = rows;
    if (!row) throw new Error('Turn insert returned no row');
    return toAgentTurn(row);
  });

  return {
    id: crypto.randomUUID(),
    conversationId: crypto.randomUUID(),
    status: 'running',
    failureCode: null,
    stopRequestedAt: null,
    model: null,
    provider: null,
    modelCallCount: 0,
    startedAt: new Date(),
    finishedAt: null,
  };
});
