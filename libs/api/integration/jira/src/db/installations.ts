import {eq, sql} from 'drizzle-orm';
import {JiraInstallationSiteMismatchError} from '#core/errors.js';
import {db} from './db.js';
import {jiraInstallations, toJiraInstallation} from './schema/installations.js';

export type JiraInstallationStatus = 'installed' | 'revoked';

export interface JiraInstallation {
  id: string;
  connectionId: string;
  cloudId: string;
  siteUrl: string;
  siteName: string;
  authorizingAccountId: string;
  scopes: string[];
  webhookIds: number[];
  webhookExpiresAt: Date | null;
  status: JiraInstallationStatus;
  tokenExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertJiraInstallationParams {
  connectionId: string;
  cloudId: string;
  siteUrl: string;
  siteName: string;
  authorizingAccountId: string;
  scopes: string[];
  webhookIds?: number[] | undefined;
  webhookExpiresAt?: Date | null | undefined;
  status: JiraInstallationStatus;
  tokenExpiresAt?: Date | null | undefined;
}

type JiraDb = ReturnType<typeof db>;
type JiraTx = Parameters<Parameters<JiraDb['transaction']>[0]>[0];

export async function upsertJiraInstallation(
  params: UpsertJiraInstallationParams,
  options: {tx?: unknown} = {},
): Promise<JiraInstallation> {
  const executor = (options.tx ?? db()) as JiraDb | JiraTx;
  const now = new Date();
  const webhookIds = params.webhookIds ?? [];
  const [row] = await executor
    .insert(jiraInstallations)
    .values({
      connectionId: params.connectionId,
      cloudId: params.cloudId,
      siteUrl: params.siteUrl,
      siteName: params.siteName,
      authorizingAccountId: params.authorizingAccountId,
      scopes: params.scopes,
      webhookIds,
      webhookExpiresAt: params.webhookExpiresAt ?? null,
      status: params.status,
      tokenExpiresAt: params.tokenExpiresAt ?? null,
    })
    .onConflictDoUpdate({
      target: jiraInstallations.connectionId,
      setWhere: eq(jiraInstallations.cloudId, params.cloudId),
      set: {
        cloudId: params.cloudId,
        siteUrl: params.siteUrl,
        siteName: params.siteName,
        authorizingAccountId: params.authorizingAccountId,
        scopes: params.scopes,
        webhookIds,
        webhookExpiresAt: params.webhookExpiresAt ?? null,
        status: params.status,
        tokenExpiresAt: params.tokenExpiresAt ?? null,
        updatedAt: now,
      },
    })
    .returning();

  if (!row) throw new JiraInstallationSiteMismatchError(params.connectionId, params.cloudId);
  return toJiraInstallation(row);
}

export async function getJiraInstallationByConnectionId(
  connectionId: string,
  options: {tx?: unknown} = {},
): Promise<JiraInstallation | undefined> {
  const executor = (options.tx ?? db()) as JiraDb | JiraTx;
  const rows = await executor
    .select()
    .from(jiraInstallations)
    .where(eq(jiraInstallations.connectionId, connectionId))
    .limit(1);
  const row = rows[0];
  if (!row) return undefined;
  return toJiraInstallation(row);
}

export async function getJiraInstallationByWebhookId(
  webhookId: number,
  options: {tx?: unknown} = {},
): Promise<JiraInstallation | undefined> {
  const executor = (options.tx ?? db()) as JiraDb | JiraTx;
  const rows = await executor
    .select()
    .from(jiraInstallations)
    .where(sql`${jiraInstallations.webhookIds} @> ${JSON.stringify([webhookId])}::jsonb`)
    .limit(1);
  const row = rows[0];
  if (!row) return undefined;
  return toJiraInstallation(row);
}

export async function markJiraInstallationRevoked(
  connectionId: string,
  options: {tx?: unknown} = {},
): Promise<JiraInstallation | undefined> {
  const executor = (options.tx ?? db()) as JiraDb | JiraTx;
  const [row] = await executor
    .update(jiraInstallations)
    .set({status: 'revoked', updatedAt: new Date()})
    .where(eq(jiraInstallations.connectionId, connectionId))
    .returning();
  if (!row) return undefined;
  return toJiraInstallation(row);
}
