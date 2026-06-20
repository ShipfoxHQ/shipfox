import {eq} from 'drizzle-orm';
import {GiteaOrgAlreadyLinkedError} from '#core/errors.js';
import {db} from './db.js';
import {giteaConnections, toGiteaConnection} from './schema/connections.js';

export interface GiteaConnection {
  id: string;
  connectionId: string;
  org: string;
  webhookId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertGiteaConnectionParams {
  connectionId: string;
  org: string;
  webhookId: string;
}

type GiteaDb = ReturnType<typeof db>;
type GiteaTx = Parameters<Parameters<GiteaDb['transaction']>[0]>[0];

export async function upsertGiteaConnection(
  params: UpsertGiteaConnectionParams,
  options: {tx?: unknown} = {},
): Promise<GiteaConnection> {
  const executor = (options.tx ?? db()) as GiteaDb | GiteaTx;
  const now = new Date();
  const [row] = await executor
    .insert(giteaConnections)
    .values({
      connectionId: params.connectionId,
      org: params.org,
      webhookId: params.webhookId,
    })
    .onConflictDoUpdate({
      target: giteaConnections.org,
      // TOCTOU guard: only (re)point this org at the connection that already
      // owns it. A concurrent connect of the same org to a different workspace
      // inserts its own connection row, so its connectionId differs here; the
      // predicate is false, Postgres updates nothing, and the empty RETURNING
      // below rolls the losing transaction back instead of silently repointing
      // the org (cross-tenant connection takeover).
      setWhere: eq(giteaConnections.connectionId, params.connectionId),
      set: {
        connectionId: params.connectionId,
        webhookId: params.webhookId,
        updatedAt: now,
      },
    })
    .returning();

  if (!row) throw new GiteaOrgAlreadyLinkedError(params.org);
  return toGiteaConnection(row);
}

export async function getGiteaConnectionByOrg(org: string): Promise<GiteaConnection | undefined> {
  const rows = await db()
    .select()
    .from(giteaConnections)
    .where(eq(giteaConnections.org, org))
    .limit(1);
  const row = rows[0];
  if (!row) return undefined;
  return toGiteaConnection(row);
}

export async function getGiteaConnectionByConnectionId(
  connectionId: string,
): Promise<GiteaConnection | undefined> {
  const rows = await db()
    .select()
    .from(giteaConnections)
    .where(eq(giteaConnections.connectionId, connectionId))
    .limit(1);
  const row = rows[0];
  if (!row) return undefined;
  return toGiteaConnection(row);
}
