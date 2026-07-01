import type {
  AgentProviderApi,
  AgentProviderRef,
  AgentThinking,
  CustomAgentModelDto,
  CustomProviderHeaderDto,
} from '@shipfox/api-agent-dto';
import {and, eq, sql} from 'drizzle-orm';
import type {AgentProviderConfig} from '#core/entities/agent-provider-config.js';
import {db} from './db.js';
import {agentProviderConfigs, toAgentProviderConfig} from './schema/agent-provider-configs.js';
import {agentWorkspaceSettings} from './schema/agent-workspace-settings.js';

export interface UpsertAgentProviderConfigParams {
  workspaceId: string;
  providerId: AgentProviderRef;
  kind?: 'builtin' | 'custom' | undefined;
  displayName?: string | null | undefined;
  api?: AgentProviderApi | null | undefined;
  baseUrl?: string | null | undefined;
  headers?: CustomProviderHeaderDto[] | null | undefined;
  models?: CustomAgentModelDto[] | null | undefined;
  encryptedCredentials: Record<string, string>;
  keyFingerprints: Record<string, string>;
  defaultModel: string | null;
  defaultThinking: AgentThinking;
  setAsDefault?: boolean | undefined;
}

export async function upsertAgentProviderConfig(
  params: UpsertAgentProviderConfigParams,
): Promise<AgentProviderConfig> {
  return await db().transaction(async (tx) => {
    const rows = await tx
      .insert(agentProviderConfigs)
      .values({
        workspaceId: params.workspaceId,
        providerId: params.providerId,
        ...(params.kind !== undefined ? {kind: params.kind} : {}),
        ...(params.displayName !== undefined ? {displayName: params.displayName} : {}),
        ...(params.api !== undefined ? {api: params.api} : {}),
        ...(params.baseUrl !== undefined ? {baseUrl: params.baseUrl} : {}),
        ...(params.headers !== undefined ? {headers: params.headers} : {}),
        ...(params.models !== undefined ? {models: params.models} : {}),
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
          ...(params.kind !== undefined ? {kind: params.kind} : {}),
          ...(params.displayName !== undefined ? {displayName: params.displayName} : {}),
          ...(params.api !== undefined ? {api: params.api} : {}),
          ...(params.baseUrl !== undefined ? {baseUrl: params.baseUrl} : {}),
          ...(params.headers !== undefined ? {headers: params.headers} : {}),
          ...(params.models !== undefined ? {models: params.models} : {}),
          defaultModel: params.defaultModel,
          defaultThinking: params.defaultThinking,
          updatedAt: sql`NOW()`,
        },
      })
      .returning();

    const row = rows[0];
    if (!row) throw new Error('Upsert returned no rows');

    if (params.setAsDefault) {
      await tx
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
        });
    }

    return toAgentProviderConfig(row);
  });
}

export async function getAgentProviderConfig(params: {
  workspaceId: string;
  providerId: AgentProviderRef;
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

export async function updateAgentProviderDefaultModel(params: {
  workspaceId: string;
  providerId: AgentProviderRef;
  defaultModel: string | null;
}): Promise<AgentProviderConfig | undefined> {
  const rows = await db()
    .update(agentProviderConfigs)
    .set({defaultModel: params.defaultModel, updatedAt: sql`NOW()`})
    .where(
      and(
        eq(agentProviderConfigs.workspaceId, params.workspaceId),
        eq(agentProviderConfigs.providerId, params.providerId),
      ),
    )
    .returning();

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
  providerId: AgentProviderRef;
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
