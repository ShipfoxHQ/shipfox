import {and, eq, gt, inArray, isNull, sql} from 'drizzle-orm';
import type {EphemeralRegistrationToken} from '#core/entities/ephemeral-registration-token.js';
import {
  ActiveEphemeralRegistrationTokenExistsError,
  ActiveEphemeralRegistrationTokensExistError,
  RegistrationTokenBatchExceedsReservationError,
  RegistrationTokenConsumedError,
  RegistrationTokenExpiredError,
  RegistrationTokenWorkspaceMismatchError,
  ReservationExpiredError,
  ReservationNotFoundError,
} from '#core/errors.js';
import {db} from './db.js';
import {
  ephemeralRegistrationTokens,
  toEphemeralRegistrationToken,
} from './schema/ephemeral-registration-tokens.js';
import {reservations} from './schema/reservations.js';
import {runnerSessions, toRunnerSession} from './schema/runner-sessions.js';

export interface CreateEphemeralRegistrationTokenParams {
  workspaceId: string;
  provisionerId: string;
  reservationId?: string | null | undefined;
  resourceId: string;
  hashedToken: string;
  prefix: string;
  expiresAt: Date;
}

export interface CreateEphemeralRegistrationTokensBatchRow {
  resourceId: string;
  hashedToken: string;
  prefix: string;
}

export interface CreateEphemeralRegistrationTokensBatchParams {
  workspaceId: string;
  provisionerId: string;
  reservationId: string;
  expiresAt: Date;
  rows: CreateEphemeralRegistrationTokensBatchRow[];
}

export async function createEphemeralRegistrationToken(
  params: CreateEphemeralRegistrationTokenParams,
): Promise<EphemeralRegistrationToken> {
  const rows = await db().transaction(async (tx) => {
    const resourceLockKey = [
      'runners_ephemeral_registration_tokens',
      params.workspaceId,
      params.provisionerId,
      params.resourceId,
    ].join(':');
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${resourceLockKey}))`);

    const [active] = await tx
      .select({id: ephemeralRegistrationTokens.id})
      .from(ephemeralRegistrationTokens)
      .where(
        and(
          eq(ephemeralRegistrationTokens.workspaceId, params.workspaceId),
          eq(ephemeralRegistrationTokens.provisionerId, params.provisionerId),
          eq(ephemeralRegistrationTokens.resourceId, params.resourceId),
          isNull(ephemeralRegistrationTokens.consumedAt),
          gt(ephemeralRegistrationTokens.expiresAt, sql`now()`),
        ),
      )
      .limit(1);

    if (active) {
      throw new ActiveEphemeralRegistrationTokenExistsError(
        params.workspaceId,
        params.provisionerId,
        params.resourceId,
      );
    }

    return await tx
      .insert(ephemeralRegistrationTokens)
      .values({
        workspaceId: params.workspaceId,
        provisionerId: params.provisionerId,
        reservationId: params.reservationId ?? null,
        resourceId: params.resourceId,
        hashedToken: params.hashedToken,
        prefix: params.prefix,
        expiresAt: params.expiresAt,
      })
      .returning();
  });

  const row = rows[0];
  if (!row) throw new Error('Insert returned no rows');
  return toEphemeralRegistrationToken(row);
}

export async function createEphemeralRegistrationTokensBatch(
  params: CreateEphemeralRegistrationTokensBatchParams,
): Promise<EphemeralRegistrationToken[]> {
  const rows = await db().transaction(async (tx) => {
    const provisionerLockKey = [
      'runners_ephemeral_registration_tokens',
      params.workspaceId,
      params.provisionerId,
    ].join(':');
    // Serialize batch callers and compose with the single-token mint's resource locks.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${provisionerLockKey}))`);
    for (const resourceId of [...new Set(params.rows.map((row) => row.resourceId))].sort()) {
      const resourceLockKey = [
        'runners_ephemeral_registration_tokens',
        params.workspaceId,
        params.provisionerId,
        resourceId,
      ].join(':');
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${resourceLockKey}))`);
    }

    const [reservation] = await tx
      .select({
        count: reservations.count,
        isExpired: sql<boolean>`${reservations.expiresAt} <= now()`,
      })
      .from(reservations)
      .where(
        and(
          eq(reservations.id, params.reservationId),
          eq(reservations.workspaceId, params.workspaceId),
          eq(reservations.provisionerId, params.provisionerId),
        ),
      )
      .limit(1);

    if (!reservation) throw new ReservationNotFoundError(params.reservationId);
    if (reservation.isExpired) throw new ReservationExpiredError(params.reservationId);
    if (params.rows.length > reservation.count) {
      throw new RegistrationTokenBatchExceedsReservationError(
        params.rows.length,
        reservation.count,
      );
    }

    const resourceIds = params.rows.map((row) => row.resourceId);
    const activeRows = await tx
      .select({resourceId: ephemeralRegistrationTokens.resourceId})
      .from(ephemeralRegistrationTokens)
      .where(
        and(
          eq(ephemeralRegistrationTokens.workspaceId, params.workspaceId),
          eq(ephemeralRegistrationTokens.provisionerId, params.provisionerId),
          inArray(ephemeralRegistrationTokens.resourceId, resourceIds),
          isNull(ephemeralRegistrationTokens.consumedAt),
          gt(ephemeralRegistrationTokens.expiresAt, sql`now()`),
        ),
      );

    if (activeRows.length > 0) {
      throw new ActiveEphemeralRegistrationTokensExistError(
        activeRows.map((row) => row.resourceId),
      );
    }

    return await tx
      .insert(ephemeralRegistrationTokens)
      .values(
        params.rows.map((row) => ({
          workspaceId: params.workspaceId,
          provisionerId: params.provisionerId,
          reservationId: params.reservationId,
          resourceId: row.resourceId,
          hashedToken: row.hashedToken,
          prefix: row.prefix,
          expiresAt: params.expiresAt,
        })),
      )
      .returning();
  });

  return rows.map(toEphemeralRegistrationToken);
}

export async function resolveEphemeralRegistrationTokenByHash(
  hashedToken: string,
): Promise<EphemeralRegistrationToken | undefined> {
  const rows = await db()
    .select()
    .from(ephemeralRegistrationTokens)
    .where(eq(ephemeralRegistrationTokens.hashedToken, hashedToken))
    .limit(1);

  const row = rows[0];
  if (!row) return undefined;
  return toEphemeralRegistrationToken(row);
}

export async function createRunnerSessionConsumingEphemeralToken(params: {
  ephemeralTokenId: string;
  workspaceId: string;
  labels: string[];
  maxClaims: number;
}) {
  return await db().transaction(async (tx) => {
    const consumed = await tx
      .update(ephemeralRegistrationTokens)
      .set({consumedAt: sql`now()`})
      .where(
        and(
          eq(ephemeralRegistrationTokens.id, params.ephemeralTokenId),
          eq(ephemeralRegistrationTokens.workspaceId, params.workspaceId),
          isNull(ephemeralRegistrationTokens.consumedAt),
          gt(ephemeralRegistrationTokens.expiresAt, sql`now()`),
        ),
      )
      .returning({id: ephemeralRegistrationTokens.id});

    if (!consumed[0]) {
      const [token] = await tx
        .select({
          workspaceId: ephemeralRegistrationTokens.workspaceId,
          consumedAt: ephemeralRegistrationTokens.consumedAt,
          isExpired: sql<boolean>`${ephemeralRegistrationTokens.expiresAt} <= now()`,
        })
        .from(ephemeralRegistrationTokens)
        .where(eq(ephemeralRegistrationTokens.id, params.ephemeralTokenId))
        .limit(1);

      if (!token) {
        throw new Error(`Ephemeral registration token not found: ${params.ephemeralTokenId}`);
      }
      if (token.workspaceId !== params.workspaceId) {
        throw new RegistrationTokenWorkspaceMismatchError(
          params.ephemeralTokenId,
          params.workspaceId,
        );
      }
      if (token.consumedAt) throw new RegistrationTokenConsumedError(params.ephemeralTokenId);
      if (token.isExpired) throw new RegistrationTokenExpiredError(params.ephemeralTokenId);
      throw new Error(
        `Ephemeral registration token could not be consumed: ${params.ephemeralTokenId}`,
      );
    }

    const [session] = await tx
      .insert(runnerSessions)
      .values({
        workspaceId: params.workspaceId,
        scope: 'workspace',
        registrationTokenId: params.ephemeralTokenId,
        registrationTokenKind: 'ephemeral',
        labels: params.labels,
        maxClaims: params.maxClaims,
        claimsUsed: 0,
      })
      .returning();

    if (!session) throw new Error('Insert returned no rows');

    await tx
      .update(ephemeralRegistrationTokens)
      .set({consumedSessionId: session.id})
      .where(eq(ephemeralRegistrationTokens.id, params.ephemeralTokenId));

    return toRunnerSession(session);
  });
}
