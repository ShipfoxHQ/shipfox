import {and, eq, gt, isNull, notInArray, sql} from 'drizzle-orm';
import {db} from './db.js';
import {capacityBootstrapCredentials, capacitySessions} from './schema/capacity-sessions.js';
import {provisionedRunners} from './schema/provisioned-runners.js';

export async function createCapacityBootstrapCredential(params: {
  capacityId: string;
  provisionerId: string;
  hashedToken: string;
  prefix: string;
  expiresAt: Date;
}): Promise<void> {
  await db().insert(capacityBootstrapCredentials).values(params);
}

export async function createPlannedCapacityWithBootstrapCredential(params: {
  provisionerId: string;
  providerKind: string | null;
  templateKey: string | null;
  hashedToken: string;
  prefix: string;
  expiresAt: Date;
}): Promise<{capacityId: string}> {
  return await db().transaction(async (tx) => {
    const [capacity] = await tx
      .insert(provisionedRunners)
      .values({
        provisionerId: params.provisionerId,
        providerKind: params.providerKind,
        templateKey: params.templateKey,
        state: 'starting',
        labels: [],
        reportedAt: new Date(),
      })
      .returning({capacityId: provisionedRunners.id});
    if (!capacity) throw new Error('Planned capacity insert returned no row');

    await tx.insert(capacityBootstrapCredentials).values({
      capacityId: capacity.capacityId,
      provisionerId: params.provisionerId,
      hashedToken: params.hashedToken,
      prefix: params.prefix,
      expiresAt: params.expiresAt,
    });
    return capacity;
  });
}

export async function resolveActiveCapacityBootstrapCredentialByHash(
  hashedToken: string,
): Promise<boolean> {
  const [credential] = await db()
    .select({id: capacityBootstrapCredentials.id})
    .from(capacityBootstrapCredentials)
    .where(
      and(
        eq(capacityBootstrapCredentials.hashedToken, hashedToken),
        isNull(capacityBootstrapCredentials.consumedAt),
        gt(capacityBootstrapCredentials.expiresAt, sql`now()`),
      ),
    )
    .limit(1);
  return Boolean(credential);
}

export async function consumeCapacityBootstrapCredential(params: {
  hashedToken: string;
  sessionHashedToken: string;
  sessionPrefix: string;
  sessionExpiresAt: Date;
}): Promise<{capacityId: string; provisionerId: string; sessionId: string} | null> {
  return await db().transaction(async (tx) => {
    const [credential] = await tx
      .update(capacityBootstrapCredentials)
      .set({consumedAt: sql`now()`})
      .where(
        and(
          eq(capacityBootstrapCredentials.hashedToken, params.hashedToken),
          isNull(capacityBootstrapCredentials.consumedAt),
          gt(capacityBootstrapCredentials.expiresAt, sql`now()`),
        ),
      )
      .returning({
        capacityId: capacityBootstrapCredentials.capacityId,
        provisionerId: capacityBootstrapCredentials.provisionerId,
      });
    if (!credential) return null;

    const [session] = await tx
      .insert(capacitySessions)
      .values({
        capacityId: credential.capacityId,
        provisionerId: credential.provisionerId,
        hashedToken: params.sessionHashedToken,
        prefix: params.sessionPrefix,
        expiresAt: params.sessionExpiresAt,
        lastSeenAt: new Date(),
      })
      .returning({id: capacitySessions.id});
    if (!session) throw new Error('Capacity session insert returned no row');
    return {...credential, sessionId: session.id};
  });
}

export async function resolveCapacitySessionByHash(hashedToken: string): Promise<{
  id: string;
  capacityId: string;
  provisionerId: string;
  expiresAt: Date;
  closedAt: Date | null;
} | null> {
  const [session] = await db()
    .select({
      id: capacitySessions.id,
      capacityId: capacitySessions.capacityId,
      provisionerId: capacitySessions.provisionerId,
      expiresAt: capacitySessions.expiresAt,
      closedAt: capacitySessions.closedAt,
    })
    .from(capacitySessions)
    .where(eq(capacitySessions.hashedToken, hashedToken))
    .limit(1);
  return session ?? null;
}

export async function touchCapacitySession(params: {sessionId: string}): Promise<void> {
  await db()
    .update(capacitySessions)
    .set({lastSeenAt: sql`now()`})
    .where(and(eq(capacitySessions.id, params.sessionId), isNull(capacitySessions.closedAt)));
}

export async function declareCapacity(params: {
  capacityId: string;
  provisionerId: string;
  labels: string[];
  providerKind: string | null;
}): Promise<boolean> {
  const updated = await db()
    .update(provisionedRunners)
    .set({labels: params.labels, providerKind: params.providerKind, updatedAt: sql`now()`})
    .where(
      and(
        eq(provisionedRunners.id, params.capacityId),
        eq(provisionedRunners.provisionerId, params.provisionerId),
        isNull(provisionedRunners.provisionedRunnerId),
        notInArray(provisionedRunners.state, ['stopped', 'failed', 'terminated']),
      ),
    )
    .returning({id: provisionedRunners.id});
  return updated.length === 1;
}
