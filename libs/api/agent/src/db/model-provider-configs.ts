import type {
  AgentThinking,
  CustomAgentModelDto,
  CustomModelProviderHeaderDto,
  ModelProviderApi,
  ModelProviderRef,
} from '@shipfox/api-agent-dto';
import {and, eq, sql} from 'drizzle-orm';
import type {ModelProviderConfig} from '#core/entities/model-provider-config.js';
import {db} from './db.js';
import {agentWorkspaceSettings} from './schema/agent-workspace-settings.js';
import {modelProviderConfigs, toModelProviderConfig} from './schema/model-provider-configs.js';

export interface UpsertModelProviderConfigParams {
  workspaceId: string;
  providerId: ModelProviderRef;
  kind?: 'builtin' | 'custom' | undefined;
  displayName?: string | null | undefined;
  api?: ModelProviderApi | null | undefined;
  baseUrl?: string | null | undefined;
  headers?: CustomModelProviderHeaderDto[] | null | undefined;
  models?: CustomAgentModelDto[] | null | undefined;
  encryptedCredentials: Record<string, string>;
  keyFingerprints: Record<string, string>;
  defaultModel: string | null;
  defaultThinking: AgentThinking;
  setAsDefault?: boolean | undefined;
}

export async function upsertModelProviderConfig(
  params: UpsertModelProviderConfigParams,
): Promise<ModelProviderConfig> {
  return await db().transaction(async (tx) => {
    const rows = await tx
      .insert(modelProviderConfigs)
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
        target: [modelProviderConfigs.workspaceId, modelProviderConfigs.providerId],
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

    return toModelProviderConfig(row);
  });
}

export async function getModelProviderConfig(params: {
  workspaceId: string;
  providerId: ModelProviderRef;
}): Promise<ModelProviderConfig | undefined> {
  const rows = await db()
    .select()
    .from(modelProviderConfigs)
    .where(
      and(
        eq(modelProviderConfigs.workspaceId, params.workspaceId),
        eq(modelProviderConfigs.providerId, params.providerId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return undefined;
  return toModelProviderConfig(row);
}

export async function updateModelProviderDefaultModel(params: {
  workspaceId: string;
  providerId: ModelProviderRef;
  defaultModel: string | null;
}): Promise<ModelProviderConfig | undefined> {
  const rows = await db()
    .update(modelProviderConfigs)
    .set({defaultModel: params.defaultModel, updatedAt: sql`NOW()`})
    .where(
      and(
        eq(modelProviderConfigs.workspaceId, params.workspaceId),
        eq(modelProviderConfigs.providerId, params.providerId),
      ),
    )
    .returning();

  const row = rows[0];
  if (!row) return undefined;
  return toModelProviderConfig(row);
}

export async function listModelProviderConfigs(
  workspaceId: string,
): Promise<ModelProviderConfig[]> {
  const rows = await db()
    .select()
    .from(modelProviderConfigs)
    .where(eq(modelProviderConfigs.workspaceId, workspaceId))
    .orderBy(modelProviderConfigs.providerId);

  return rows.map(toModelProviderConfig);
}

export async function deleteModelProviderConfig(params: {
  workspaceId: string;
  providerId: ModelProviderRef;
}): Promise<boolean> {
  return await db().transaction(async (tx) => {
    const deleted = await tx
      .delete(modelProviderConfigs)
      .where(
        and(
          eq(modelProviderConfigs.workspaceId, params.workspaceId),
          eq(modelProviderConfigs.providerId, params.providerId),
        ),
      )
      .returning({id: modelProviderConfigs.id});

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
