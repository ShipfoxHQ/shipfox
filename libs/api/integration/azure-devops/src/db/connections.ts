import {eq} from 'drizzle-orm';
import {AzureDevOpsOrganizationAlreadyLinkedError} from '#core/errors.js';
import {db} from './db.js';
import {azureDevOpsConnections, toAzureDevOpsConnection} from './schema/connections.js';

export interface AzureDevOpsConnection {
  id: string;
  connectionId: string;
  organization: string;
  webhookUsername: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertAzureDevOpsConnectionParams {
  connectionId: string;
  organization: string;
  webhookUsername: string;
}

type AzureDevOpsDb = ReturnType<typeof db>;
type AzureDevOpsTx = Parameters<Parameters<AzureDevOpsDb['transaction']>[0]>[0];

function executor(tx: unknown): AzureDevOpsDb | AzureDevOpsTx {
  return (tx ?? db()) as AzureDevOpsDb | AzureDevOpsTx;
}

export async function upsertAzureDevOpsConnection(
  params: UpsertAzureDevOpsConnectionParams,
  options: {tx?: unknown} = {},
): Promise<AzureDevOpsConnection> {
  const now = new Date();
  const [row] = await executor(options.tx)
    .insert(azureDevOpsConnections)
    .values(params)
    .onConflictDoUpdate({
      target: azureDevOpsConnections.organization,
      // Only re-point an organization at the connection that already owns it. A concurrent
      // connect of the same organization from another workspace updates nothing here, and the
      // empty RETURNING rolls that transaction back instead of taking the organization over.
      setWhere: eq(azureDevOpsConnections.connectionId, params.connectionId),
      // The hook user name is set once: a reconnect keeps it, so Service Hooks configured in
      // Azure DevOps keep working if storing the new password fails.
      set: {updatedAt: now},
    })
    .returning();

  if (!row) throw new AzureDevOpsOrganizationAlreadyLinkedError(params.organization);
  return toAzureDevOpsConnection(row);
}

export async function getAzureDevOpsConnectionByOrganization(
  organization: string,
  options: {tx?: unknown} = {},
): Promise<AzureDevOpsConnection | undefined> {
  const rows = await executor(options.tx)
    .select()
    .from(azureDevOpsConnections)
    .where(eq(azureDevOpsConnections.organization, organization))
    .limit(1);
  const row = rows[0];
  return row ? toAzureDevOpsConnection(row) : undefined;
}

export async function getAzureDevOpsConnectionByConnectionId(
  connectionId: string,
  options: {tx?: unknown} = {},
): Promise<AzureDevOpsConnection | undefined> {
  const rows = await executor(options.tx)
    .select()
    .from(azureDevOpsConnections)
    .where(eq(azureDevOpsConnections.connectionId, connectionId))
    .limit(1);
  const row = rows[0];
  return row ? toAzureDevOpsConnection(row) : undefined;
}

export async function deleteAzureDevOpsConnectionByConnectionId(
  connectionId: string,
  options: {tx?: unknown} = {},
): Promise<void> {
  await executor(options.tx)
    .delete(azureDevOpsConnections)
    .where(eq(azureDevOpsConnections.connectionId, connectionId));
}
