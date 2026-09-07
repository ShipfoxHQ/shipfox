import type {
  AdministrationActionEvent,
  AdministrationActionEventMap,
} from '@shipfox/api-common-dto';
import {writeOutboxEvent} from '@shipfox/node-outbox';
import {and, eq, sql} from 'drizzle-orm';
import {AdminIdempotencyKeyReuseError} from '#core/errors.js';
import type {db} from './db.js';
import {
  type AdminCommandResultDb,
  adminCommandResults,
  type StoredAdminCommandResult,
} from './schema/admin-command-results.js';
import {authOutbox} from './schema/outbox.js';

export type Tx = Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0];

export interface AdminCommandTransactionParams {
  actorId: string;
  idempotencyKeyFingerprint: string;
  requestFingerprint: string;
  event: AdministrationActionEvent;
}

export type AdminCommandResultLookup = Pick<
  AdminCommandTransactionParams,
  'actorId' | 'idempotencyKeyFingerprint' | 'requestFingerprint'
> & {command: string};

export type AdminCommandResultKey = Pick<
  AdminCommandTransactionParams,
  'actorId' | 'idempotencyKeyFingerprint' | 'requestFingerprint'
>;

export async function lockAdminCommand(
  tx: Tx,
  params: Pick<AdminCommandTransactionParams, 'actorId' | 'idempotencyKeyFingerprint'>,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`auth_admin_command:${params.actorId}:${params.idempotencyKeyFingerprint}`}))`,
  );
}

export type AdminOwnerGrantsLockMode = 'shared' | 'exclusive';

/**
 * Shared locks protect reads that depend on administrator-grant state. Grant
 * mutations keep the exclusive default, so mints for different actors can
 * proceed together without racing a role change.
 */
export async function lockAdminOwnerGrants(
  tx: Tx,
  mode: AdminOwnerGrantsLockMode = 'exclusive',
): Promise<void> {
  if (mode === 'shared') {
    await tx.execute(sql`select pg_advisory_xact_lock_shared(hashtext('auth_admin_owner_grants'))`);
    return;
  }
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('auth_admin_owner_grants'))`);
}

/**
 * Window mutations acquire this actor-scoped lock after the command lock and,
 * when needed, the shared grant lock. No window path acquires a grant lock
 * after this lock.
 */
export async function lockImpersonationWindowActor(tx: Tx, actorId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`auth_impersonation_window:${actorId}`}))`,
  );
}

/**
 * Applies the lock order used by window commands. Owned Stop omits the grant
 * lock; Start, Continue, and owner Stop pass `shared`.
 */
export async function lockImpersonationWindowMutation(
  tx: Tx,
  params: Pick<AdminCommandTransactionParams, 'actorId' | 'idempotencyKeyFingerprint'>,
  options: {windowActorId: string; grantLock: 'shared' | null},
): Promise<void> {
  await lockAdminCommand(tx, params);
  if (options.grantLock) await lockAdminOwnerGrants(tx, options.grantLock);
  await lockImpersonationWindowActor(tx, options.windowActorId);
}

export async function findAdminCommandResult(
  tx: Tx,
  params: AdminCommandResultLookup,
): Promise<AdminCommandResultDb | undefined> {
  const rows = await tx
    .select()
    .from(adminCommandResults)
    .where(
      and(
        eq(adminCommandResults.actorId, params.actorId),
        eq(adminCommandResults.idempotencyKeyFingerprint, params.idempotencyKeyFingerprint),
      ),
    )
    .limit(1);
  const result = rows[0];
  if (!result) return undefined;
  if (
    result.command !== params.command ||
    result.requestFingerprint !== params.requestFingerprint
  ) {
    throw new AdminIdempotencyKeyReuseError();
  }
  return result;
}

export async function storeAdminCommandResult(
  tx: Tx,
  params: AdminCommandResultLookup,
  result: StoredAdminCommandResult,
): Promise<void> {
  await tx.insert(adminCommandResults).values({
    actorId: params.actorId,
    idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
    command: params.command,
    requestFingerprint: params.requestFingerprint,
    result,
  });
}

/**
 * Replaces the stored result of an already-committed command, used by
 * impersonation replays to append the newly issued token's fingerprint while
 * keeping the original `expires_at`.
 */
export async function updateAdminCommandResult(
  tx: Tx,
  params: AdminCommandResultKey,
  result: StoredAdminCommandResult,
): Promise<void> {
  await tx
    .update(adminCommandResults)
    .set({result})
    .where(
      and(
        eq(adminCommandResults.actorId, params.actorId),
        eq(adminCommandResults.idempotencyKeyFingerprint, params.idempotencyKeyFingerprint),
        eq(adminCommandResults.requestFingerprint, params.requestFingerprint),
      ),
    );
}

export async function writeAdminAction(tx: Tx, event: AdministrationActionEvent): Promise<void> {
  await writeOutboxEvent<AdministrationActionEventMap>(tx, authOutbox, {
    type: 'administration.action.performed',
    payload: event,
  });
}
