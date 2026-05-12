import {randomUUID} from 'node:crypto';
import {sql} from 'drizzle-orm';
import {db as githubDb} from '#db/db.js';
import {upsertGithubInstallation} from '#db/installations.js';

// Webhook tests target tables owned by @shipfox/api-integration-core. We could
// import the core helpers, but doing so introduces a workspace dependency cycle
// (core already depends on github at runtime). Reaching into the integrations_*
// tables through raw SQL avoids the cycle and keeps the test scoped to what the
// HTTP route actually does.

export const db = githubDb;

export {upsertGithubInstallation};

export async function truncateIntegrationsState(): Promise<void> {
  await db().execute(sql`TRUNCATE integrations_connections CASCADE`);
  await db().execute(sql`TRUNCATE integrations_outbox CASCADE`);
  await db().execute(sql`TRUNCATE integrations_webhook_deliveries CASCADE`);
  await db().execute(sql`TRUNCATE integrations_github_installations CASCADE`);
}

export interface InsertConnectionInput {
  id?: string | undefined;
  workspaceId?: string | undefined;
  externalAccountId: string;
  displayName?: string | undefined;
}

export async function insertConnection(input: InsertConnectionInput): Promise<{
  id: string;
  workspaceId: string;
}> {
  const id = input.id ?? randomUUID();
  const workspaceId = input.workspaceId ?? randomUUID();
  await db().execute(sql`
    INSERT INTO integrations_connections (
      id,
      workspace_id,
      provider,
      external_account_id,
      display_name,
      lifecycle_status
    )
    VALUES (
      ${id}::uuid,
      ${workspaceId}::uuid,
      'github',
      ${input.externalAccountId},
      ${input.displayName ?? 'Test workspace'},
      'active'
    )
  `);
  return {id, workspaceId};
}

export interface InsertGithubInstallationInput {
  connectionId: string;
  installationId: number;
}

export async function insertGithubInstallation(
  input: InsertGithubInstallationInput,
): Promise<void> {
  await upsertGithubInstallation({
    connectionId: input.connectionId,
    installationId: String(input.installationId),
    accountLogin: 'shipfox',
    accountType: 'Organization',
    repositorySelection: 'all',
    latestEvent: {id: 1},
  });
}

export interface IntegrationConnectionRow {
  id: string;
  workspaceId: string;
}

export async function getIntegrationConnectionById(
  id: string,
  options: {tx?: unknown} = {},
): Promise<IntegrationConnectionRow | undefined> {
  // biome-ignore lint/suspicious/noExplicitAny: tx is loose by design
  const executor = (options.tx as any) ?? db();
  const result = await executor.execute(sql`
    SELECT id, workspace_id AS "workspaceId"
    FROM integrations_connections
    WHERE id = ${id}::uuid
    LIMIT 1
  `);
  const rows = (result as unknown as {rows?: IntegrationConnectionRow[]}).rows ?? [];
  return rows[0];
}

export interface IntegrationRepositoryPushedEvent {
  provider: string;
  connectionId: string;
  workspaceId: string;
  externalRepositoryId: string;
  ref: string;
  headCommitSha: string;
  defaultBranch: string;
  isDefaultBranch: boolean;
  deliveryId: string;
  receivedAt: string;
}

export async function publishRepositoryPushed(params: {
  tx: unknown;
  event: IntegrationRepositoryPushedEvent;
}): Promise<{published: boolean}> {
  // biome-ignore lint/suspicious/noExplicitAny: tx is loose by design
  const tx = params.tx as any;
  const insert = await tx.execute(sql`
    INSERT INTO integrations_webhook_deliveries (provider, delivery_id)
    VALUES (${params.event.provider}, ${params.event.deliveryId})
    ON CONFLICT DO NOTHING
    RETURNING delivery_id
  `);
  if (((insert as {rowCount?: number}).rowCount ?? 0) === 0) {
    return {published: false};
  }
  await tx.execute(sql`
    INSERT INTO integrations_outbox (event_type, payload)
    VALUES (
      'integrations.repository.pushed',
      ${JSON.stringify(params.event)}::jsonb
    )
  `);
  return {published: true};
}

export async function recordDeliveryOnly(params: {
  tx: unknown;
  provider: string;
  deliveryId: string;
}): Promise<void> {
  // biome-ignore lint/suspicious/noExplicitAny: tx is loose by design
  const tx = params.tx as any;
  await tx.execute(sql`
    INSERT INTO integrations_webhook_deliveries (provider, delivery_id)
    VALUES (${params.provider}, ${params.deliveryId})
    ON CONFLICT DO NOTHING
  `);
}

export interface OutboxRow {
  id: string;
  eventType: string;
  payload: IntegrationRepositoryPushedEvent;
}

export async function readIntegrationsOutbox(): Promise<OutboxRow[]> {
  const result = await db().execute(sql`
    SELECT id, event_type AS "eventType", payload
    FROM integrations_outbox
    ORDER BY created_at
  `);
  return (result as unknown as {rows?: OutboxRow[]}).rows ?? [];
}

export interface DeliveryRow {
  provider: string;
  deliveryId: string;
}

export async function readWebhookDeliveries(): Promise<DeliveryRow[]> {
  const result = await db().execute(sql`
    SELECT provider, delivery_id AS "deliveryId"
    FROM integrations_webhook_deliveries
    ORDER BY received_at
  `);
  return (result as unknown as {rows?: DeliveryRow[]}).rows ?? [];
}
