import type {AgentThinking, SupportedAgentProviderId} from '@shipfox/api-agent-dto';
import {and, eq, sql} from 'drizzle-orm';
import type {AgentProviderConfig} from '#core/entities/agent-provider-config.js';
import {db} from './db.js';
import {agentProviderConfigs, toAgentProviderConfig} from './schema/agent-provider-configs.js';
import {agentWorkspaceSettings} from './schema/agent-workspace-settings.js';

export interface UpsertAgentProviderConfigParams {
  workspaceId: string;
  providerId: SupportedAgentProviderId;
  encryptedCredentials: Record<string, string>;
  keyFingerprints: Record<string, string>;
  defaultModel: string;
  defaultThinking: AgentThinking;
}

export async function upsertAgentProviderConfig(
  params: UpsertAgentProviderConfigParams,
): Promise<AgentProviderConfig> {
  const rows = await db()
    .insert(agentProviderConfigs)
    .values({
      workspaceId: params.workspaceId,
      providerId: params.providerId,
      encryptedCredentials: params.encryptedCredentials,
      keyFingerprints: params.keyFingerprints,
      defaultModel: params.defaultModel,
      defaultThinking: params.defaultThinking,
    })
    .onConflictDoUpdate({
      target: [agentProviderConfigs.workspaceId, agentProviderConfigs.providerId],
      set: {
        encryptedCredentials: params.encryptedCredentials,
        keyFingerprints: params.keyFingerprints,
        defaultModel: params.defaultModel,
        defaultThinking: params.defaultThinking,
        updatedAt: sql`NOW()`,
      },
    })
    .returning();

  const row = rows[0];
  if (!row) throw new Error('Upsert returned no rows');
  return toAgentProviderConfig(row);
}

export async function getAgentProviderConfig(params: {
  workspaceId: string;
  providerId: SupportedAgentProviderId;
}): Promise<AgentProviderConfig | undefined> {
  const rows = await db()
    .select()
    .from(agentProviderConfigs)
    .where(
      and(
        eq(agentProviderConfigs.workspaceId, params.workspaceId),
        eq(agentProviderConfigs.providerId, params.providerId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return undefined;
  return toAgentProviderConfig(row);
}

export async function listAgentProviderConfigs(
  workspaceId: string,
): Promise<AgentProviderConfig[]> {
  const rows = await db()
    .select()
    .from(agentProviderConfigs)
    .where(eq(agentProviderConfigs.workspaceId, workspaceId))
    .orderBy(agentProviderConfigs.providerId);

  return rows.map(toAgentProviderConfig);
}

export async function deleteAgentProviderConfig(params: {
  workspaceId: string;
  providerId: SupportedAgentProviderId;
}): Promise<boolean> {
  return await db().transaction(async (tx) => {
    const deleted = await tx
      .delete(agentProviderConfigs)
      .where(
        and(
          eq(agentProviderConfigs.workspaceId, params.workspaceId),
          eq(agentProviderConfigs.providerId, params.providerId),
        ),
      )
      .returning({id: agentProviderConfigs.id});

    if (deleted.length === 0) return false;

    await tx
      .update(agentWorkspaceSettings)
      .set({defaultProviderId: null, updatedAt: sql`NOW()`})
      .where(
        and(
          eq(agentWorkspaceSettings.workspaceId, params.workspaceId),
          eq(agentWorkspaceSettings.defaultProviderId, params.providerId),
        ),
      );

    return true;
  });
}
