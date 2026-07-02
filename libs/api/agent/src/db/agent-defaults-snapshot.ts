import type {SupportedModelProviderId} from '@shipfox/api-agent-dto';
import {eq, or} from 'drizzle-orm';
import type {ModelProviderConfig} from '#core/entities/model-provider-config.js';
import {db} from './db.js';
import {agentWorkspaceSettings} from './schema/agent-workspace-settings.js';
import {modelProviderConfigs, toModelProviderConfig} from './schema/model-provider-configs.js';

export interface AgentWorkspaceDefaultsSnapshot {
  readonly defaultProviderId?: SupportedModelProviderId | null | undefined;
  readonly providerConfigs: ModelProviderConfig[];
}

export async function getAgentWorkspaceDefaultsSnapshot(
  workspaceId: string,
): Promise<AgentWorkspaceDefaultsSnapshot> {
  const rows = await db()
    .select({
      settingsWorkspaceId: agentWorkspaceSettings.workspaceId,
      workspaceDefaultProviderId: agentWorkspaceSettings.defaultProviderId,
      providerConfig: modelProviderConfigs,
    })
    .from(agentWorkspaceSettings)
    .fullJoin(
      modelProviderConfigs,
      eq(modelProviderConfigs.workspaceId, agentWorkspaceSettings.workspaceId),
    )
    .where(
      or(
        eq(agentWorkspaceSettings.workspaceId, workspaceId),
        eq(modelProviderConfigs.workspaceId, workspaceId),
      ),
    )
    .orderBy(modelProviderConfigs.providerId);

  const settingsRow = rows.find((row) => row.settingsWorkspaceId !== null);
  return {
    defaultProviderId: settingsRow?.workspaceDefaultProviderId as
      | SupportedModelProviderId
      | null
      | undefined,
    providerConfigs: rows.flatMap((row) =>
      row.providerConfig === null ? [] : [toModelProviderConfig(row.providerConfig)],
    ),
  };
}
