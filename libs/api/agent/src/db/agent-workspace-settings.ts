import type {AgentProviderRef} from '@shipfox/api-agent-dto';
import {and, eq, sql} from 'drizzle-orm';
import type {AgentWorkspaceSettings} from '#core/entities/agent-workspace-settings.js';
import {AgentProviderConfigNotFoundError} from '#core/errors.js';
import {db} from './db.js';
import {agentProviderConfigs} from './schema/agent-provider-configs.js';
import {
  agentWorkspaceSettings,
  toAgentWorkspaceSettings,
} from './schema/agent-workspace-settings.js';

export async function getAgentWorkspaceSettings(
  workspaceId: string,
): Promise<AgentWorkspaceSettings | undefined> {
  const rows = await db()
    .select()
    .from(agentWorkspaceSettings)
    .where(eq(agentWorkspaceSettings.workspaceId, workspaceId))
    .limit(1);

  const row = rows[0];
  if (!row) return undefined;
  return toAgentWorkspaceSettings(row);
}

export async function setDefaultAgentProvider(params: {
  workspaceId: string;
  providerId: AgentProviderRef | null;
}): Promise<AgentWorkspaceSettings> {
  return await db().transaction(async (tx) => {
    if (params.providerId !== null) {
      const existingRows = await tx
        .select({id: agentProviderConfigs.id})
        .from(agentProviderConfigs)
        .where(
          and(
            eq(agentProviderConfigs.workspaceId, params.workspaceId),
            eq(agentProviderConfigs.providerId, params.providerId),
          ),
        )
        .limit(1)
        .for('update');

      if (!existingRows[0]) {
        throw new AgentProviderConfigNotFoundError(params.workspaceId, params.providerId);
      }
    }

    const rows = await tx
      .insert(agentWorkspaceSettings)
      .values({
        workspaceId: params.workspaceId,
        defaultProviderId: params.providerId,
      })
      .onConflictDoUpdate({
        target: agentWorkspaceSettings.workspaceId,
        set: {
          defaultProviderId: params.providerId,
          updatedAt: sql`NOW()`,
        },
      })
      .returning();

    const row = rows[0];
    if (!row) throw new Error('Upsert returned no rows');
    return toAgentWorkspaceSettings(row);
  });
}
