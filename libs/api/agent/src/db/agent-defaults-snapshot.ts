import type {SupportedAgentProviderId} from '@shipfox/api-agent-dto';
import {eq, or} from 'drizzle-orm';
import type {AgentProviderConfig} from '#core/entities/agent-provider-config.js';
import {db} from './db.js';
import {agentProviderConfigs, toAgentProviderConfig} from './schema/agent-provider-configs.js';
import {agentWorkspaceSettings} from './schema/agent-workspace-settings.js';

export interface AgentWorkspaceDefaultsSnapshot {
  readonly defaultProviderId?: SupportedAgentProviderId | null | undefined;
  readonly providerConfigs: AgentProviderConfig[];
}

export async function getAgentWorkspaceDefaultsSnapshot(
  workspaceId: string,
): Promise<AgentWorkspaceDefaultsSnapshot> {
  const rows = await db()
    .select({
      settingsWorkspaceId: agentWorkspaceSettings.workspaceId,
      workspaceDefaultProviderId: agentWorkspaceSettings.defaultProviderId,
      providerConfig: agentProviderConfigs,
    })
    .from(agentWorkspaceSettings)
    .fullJoin(
      agentProviderConfigs,
      eq(agentProviderConfigs.workspaceId, agentWorkspaceSettings.workspaceId),
    )
    .where(
      or(
        eq(agentWorkspaceSettings.workspaceId, workspaceId),
        eq(agentProviderConfigs.workspaceId, workspaceId),
      ),
    )
    .orderBy(agentProviderConfigs.providerId);

  const settingsRow = rows.find((row) => row.settingsWorkspaceId !== null);
  return {
    defaultProviderId: settingsRow?.workspaceDefaultProviderId as
      | SupportedAgentProviderId
      | null
      | undefined,
    providerConfigs: rows.flatMap((row) =>
      row.providerConfig === null ? [] : [toAgentProviderConfig(row.providerConfig)],
    ),
  };
}
