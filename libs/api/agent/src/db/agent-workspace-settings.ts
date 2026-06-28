import type {SupportedAgentProviderId} from '@shipfox/api-agent-dto';
import {eq, sql} from 'drizzle-orm';
import type {AgentWorkspaceSettings} from '#core/entities/agent-workspace-settings.js';
import {db} from './db.js';
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
  providerId: SupportedAgentProviderId | null;
}): Promise<AgentWorkspaceSettings> {
  const rows = await db()
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
}
