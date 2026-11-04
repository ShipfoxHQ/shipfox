import {and, eq, inArray} from 'drizzle-orm';
import type {AgentSubscription} from '#core/entities/agent-subscription.js';
import {db} from './db.js';
import {agentSubscriptions, toAgentSubscription} from './schema/agent-subscriptions.js';

export interface AgentRuleInput {
  source: string;
  filter?: string | undefined;
}

export interface ProjectAgentSubscriptionsParams {
  workspaceId: string;
  projectId: string;
  /** Every rule the project's agents declare. An agent that is absent loses its subscriptions. */
  agents: readonly {key: string; rules: readonly AgentRuleInput[]}[];
}

/**
 * Makes the project's agent subscriptions match the rules of its agent files. A rule that stays
 * keeps its row and its creation date, because the earliest binding wins when rules overlap.
 */
export async function projectAgentSubscriptions(
  params: ProjectAgentSubscriptionsParams,
): Promise<void> {
  const wanted = new Map<string, {agentKey: string; source: string; filter: string | null}>();
  for (const agent of params.agents) {
    for (const rule of agent.rules) {
      const filter = rule.filter ?? null;
      wanted.set(ruleKey({agentKey: agent.key, source: rule.source, filter}), {
        agentKey: agent.key,
        source: rule.source,
        filter,
      });
    }
  }

  await db().transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(agentSubscriptions)
      .where(eq(agentSubscriptions.projectId, params.projectId));

    const stale = existing.filter((row) => !wanted.has(ruleKey(row)));
    if (stale.length > 0) {
      await tx.delete(agentSubscriptions).where(
        and(
          eq(agentSubscriptions.projectId, params.projectId),
          inArray(
            agentSubscriptions.id,
            stale.map((row) => row.id),
          ),
        ),
      );
    }

    const present = new Set(existing.map(ruleKey));
    const missing = [...wanted.entries()].filter(([key]) => !present.has(key));
    if (missing.length === 0) return;
    await tx
      .insert(agentSubscriptions)
      .values(
        missing.map(([, rule]) => ({
          workspaceId: params.workspaceId,
          projectId: params.projectId,
          ...rule,
        })),
      )
      .onConflictDoNothing();
  });
}

export async function listAgentSubscriptionsByProject(
  projectId: string,
): Promise<AgentSubscription[]> {
  const rows = await db()
    .select()
    .from(agentSubscriptions)
    .where(eq(agentSubscriptions.projectId, projectId));
  return rows.map(toAgentSubscription);
}

function ruleKey(rule: {agentKey: string; source: string; filter: string | null}): string {
  return JSON.stringify([rule.agentKey, rule.source, rule.filter ?? '']);
}
