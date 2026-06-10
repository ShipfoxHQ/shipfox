import {randomUUID} from 'node:crypto';
import type {IntegrationConnection} from '@shipfox/api-integration-core-dto';
import {sql} from 'drizzle-orm';
import {db as sentryDb} from '#db/db.js';
import {type SentryInstallationStatus, upsertSentryInstallation} from '#db/installations.js';

// Webhook tests target tables owned by @shipfox/api-integration-core. Importing
// the core helpers would create a workspace dependency cycle (core already
// depends on sentry at runtime). Reaching into the integrations_* tables through
// raw SQL avoids the cycle and keeps the test scoped to what the HTTP route does.

export const db = sentryDb;

export {upsertSentryInstallation};

export async function truncateIntegrationsState(): Promise<void> {
  await db().execute(sql`TRUNCATE integrations_connections CASCADE`);
  await db().execute(sql`TRUNCATE integrations_outbox CASCADE`);
  await db().execute(sql`TRUNCATE integrations_webhook_deliveries CASCADE`);
  await db().execute(sql`TRUNCATE integrations_sentry_installations CASCADE`);
}

export interface InsertConnectionInput {
  id?: string | undefined;
  workspaceId?: string | undefined;
  externalAccountId: string;
  displayName?: string | undefined;
  lifecycleStatus?: string | undefined;
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
      'sentry',
      ${input.externalAccountId},
      ${input.displayName ?? 'Sentry acme'},
      ${input.lifecycleStatus ?? 'active'}
    )
  `);
  return {id, workspaceId};
}

export interface InsertSentryInstallationInput {
  connectionId: string;
  installationUuid: string;
  orgSlug?: string | undefined;
  status?: SentryInstallationStatus | undefined;
}

export async function insertSentryInstallation(
  input: InsertSentryInstallationInput,
): Promise<void> {
  await upsertSentryInstallation({
    connectionId: input.connectionId,
    installationUuid: input.installationUuid,
    orgSlug: input.orgSlug ?? 'acme',
    status: input.status ?? 'installed',
  });
}

export async function getIntegrationConnectionById(
  id: string,
  options: {tx?: unknown} = {},
): Promise<IntegrationConnection | undefined> {
  // biome-ignore lint/suspicious/noExplicitAny: tx is loose by design
  const executor = (options.tx as any) ?? db();
  const result = await executor.execute(sql`
    SELECT
      id,
      workspace_id AS "workspaceId",
      provider,
      external_account_id AS "externalAccountId",
      display_name AS "displayName",
      lifecycle_status AS "lifecycleStatus",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM integrations_connections
    WHERE id = ${id}::uuid
    LIMIT 1
  `);
  const rows = (result as unknown as {rows?: IntegrationConnection[]}).rows ?? [];
  return rows[0];
}

export async function updateConnectionLifecycleStatus(
  params: {id: string; lifecycleStatus: string},
  options: {tx?: unknown} = {},
): Promise<void> {
  // biome-ignore lint/suspicious/noExplicitAny: tx is loose by design
  const executor = (options.tx as any) ?? db();
  await executor.execute(sql`
    UPDATE integrations_connections
    SET lifecycle_status = ${params.lifecycleStatus}, updated_at = now()
    WHERE id = ${params.id}::uuid
  `);
}

export interface IntegrationEventReceivedEvent {
  source: string;
  event: string;
  workspaceId: string;
  connectionId: string;
  deliveryId: string;
  receivedAt: string;
  payload: unknown;
}

export async function publishIntegrationEventReceived(params: {
  tx: unknown;
  event: IntegrationEventReceivedEvent;
}): Promise<{published: boolean}> {
  // biome-ignore lint/suspicious/noExplicitAny: tx is loose by design
  const tx = params.tx as any;
  const insert = await tx.execute(sql`
    INSERT INTO integrations_webhook_deliveries (provider, delivery_id)
    VALUES (${params.event.source}, ${params.event.deliveryId})
    ON CONFLICT DO NOTHING
    RETURNING delivery_id
  `);
  if (((insert as {rowCount?: number}).rowCount ?? 0) === 0) {
    return {published: false};
  }
  await tx.execute(sql`
    INSERT INTO integrations_outbox (event_type, payload)
    VALUES (
      'integrations.event.received',
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
  payload: IntegrationEventReceivedEvent;
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

export interface SentryInstallationRow {
  installationUuid: string;
  status: string;
  connectionId: string;
}

export async function readSentryInstallations(): Promise<SentryInstallationRow[]> {
  const result = await db().execute(sql`
    SELECT installation_uuid AS "installationUuid", status, connection_id AS "connectionId"
    FROM integrations_sentry_installations
    ORDER BY created_at
  `);
  return (result as unknown as {rows?: SentryInstallationRow[]}).rows ?? [];
}
