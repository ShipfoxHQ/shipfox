import type {ModelProviderRef} from '@shipfox/api-agent-dto';
import {and, eq, sql} from 'drizzle-orm';
import type {AgentWorkspaceSettings} from '#core/entities/agent-workspace-settings.js';
import {ModelProviderConfigNotFoundError} from '#core/errors.js';
import {db} from './db.js';
import {
  agentWorkspaceSettings,
  toAgentWorkspaceSettings,
} from './schema/agent-workspace-settings.js';
import {modelProviderConfigs} from './schema/model-provider-configs.js';

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

export async function setDefaultModelProvider(params: {
  workspaceId: string;
  modelProviderId: ModelProviderRef | null;
}): Promise<AgentWorkspaceSettings> {
  return await db().transaction(async (tx) => {
    if (params.modelProviderId !== null) {
      const existingRows = await tx
        .select({id: modelProviderConfigs.id})
        .from(modelProviderConfigs)
        .where(
          and(
            eq(modelProviderConfigs.workspaceId, params.workspaceId),
            eq(modelProviderConfigs.modelProviderId, params.modelProviderId),
          ),
        )
        .limit(1)
        .for('update');

      if (!existingRows[0]) {
        throw new ModelProviderConfigNotFoundError(params.workspaceId, params.modelProviderId);
      }
    }

    const rows = await tx
      .insert(agentWorkspaceSettings)
      .values({
        workspaceId: params.workspaceId,
        defaultModelProviderId: params.modelProviderId,
      })
      .onConflictDoUpdate({
        target: agentWorkspaceSettings.workspaceId,
        set: {
          defaultModelProviderId: params.modelProviderId,
          updatedAt: sql`NOW()`,
        },
      })
      .returning();

    const row = rows[0];
    if (!row) throw new Error('Upsert returned no rows');
    return toAgentWorkspaceSettings(row);
  });
}
