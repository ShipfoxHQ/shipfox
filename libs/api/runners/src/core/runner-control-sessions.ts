import type {RunnerToolCapabilitiesDto} from '@shipfox/api-runners-dto';
import {extractDisplayPrefix, generateOpaqueToken, hashOpaqueToken} from '@shipfox/node-tokens';
import {canonicalizeLabels} from '@shipfox/runner-labels';
import {and, eq, gt, isNull, notInArray, sql} from 'drizzle-orm';
import {db} from '#db/db.js';
import {terminalStates} from '#db/runner-instances.js';
import {runnerBootstrapTokens, runnerControlSessions} from '#db/schema/runner-control-sessions.js';
import {providerRunners} from '#db/schema/runner-instances.js';

export class RunnerBootstrapTokenInvalidError extends Error {
  constructor() {
    super('Runner bootstrap token is invalid, expired, or has already been used');
    this.name = 'RunnerBootstrapTokenInvalidError';
  }
}

export class RunnerControlSessionInvalidError extends Error {
  constructor() {
    super('Runner control session is invalid, expired, or closed');
    this.name = 'RunnerControlSessionInvalidError';
  }
}

export async function createRunnerInstancesWithBootstrapTokens(params: {
  provisionerId: string;
  providerKind?: string | null;
  runnerInstances: Array<{templateKey?: string | null}>;
  ttlSeconds: number;
}): Promise<Array<{runnerInstanceId: string; bootstrapToken: string}>> {
  const expiresAt = new Date(Date.now() + params.ttlSeconds * 1000);
  return await db().transaction(async (tx) => {
    const instances = await tx
      .insert(providerRunners)
      .values(
        params.runnerInstances.map((runner) => ({
          provisionerId: params.provisionerId,
          providerKind: params.providerKind ?? null,
          templateKey: runner.templateKey ?? null,
          state: 'starting' as const,
          labels: [],
          reportedAt: new Date(),
        })),
      )
      .returning({id: providerRunners.id});
    const results = instances.map((instance) => ({
      runnerInstanceId: instance.id,
      bootstrapToken: generateOpaqueToken('runnerBootstrapToken'),
    }));
    await tx.insert(runnerBootstrapTokens).values(
      results.map((result) => ({
        runnerInstanceId: result.runnerInstanceId,
        provisionerId: params.provisionerId,
        hashedToken: hashOpaqueToken(result.bootstrapToken),
        prefix: extractDisplayPrefix(result.bootstrapToken),
        expiresAt,
      })),
    );
    return results;
  });
}

export async function exchangeRunnerBootstrapToken(params: {
  rawToken: string;
  ttlSeconds: number;
}): Promise<{runnerInstanceId: string; controlSessionToken: string; expiresAt: Date}> {
  const controlSessionToken = generateOpaqueToken('runnerControlSession');
  const expiresAt = new Date(Date.now() + params.ttlSeconds * 1000);
  return await db().transaction(async (tx) => {
    const [bootstrap] = await tx
      .update(runnerBootstrapTokens)
      .set({consumedAt: sql`now()`})
      .where(
        and(
          eq(runnerBootstrapTokens.hashedToken, hashOpaqueToken(params.rawToken)),
          isNull(runnerBootstrapTokens.consumedAt),
          isNull(runnerBootstrapTokens.revokedAt),
          gt(runnerBootstrapTokens.expiresAt, sql`now()`),
        ),
      )
      .returning();
    if (!bootstrap) throw new RunnerBootstrapTokenInvalidError();
    const [session] = await tx
      .insert(runnerControlSessions)
      .values({
        runnerInstanceId: bootstrap.runnerInstanceId,
        provisionerId: bootstrap.provisionerId,
        hashedToken: hashOpaqueToken(controlSessionToken),
        prefix: extractDisplayPrefix(controlSessionToken),
        expiresAt,
      })
      .returning({id: runnerControlSessions.id});
    if (!session) throw new Error('Runner control session insert returned no row');
    return {runnerInstanceId: bootstrap.runnerInstanceId, controlSessionToken, expiresAt};
  });
}

export async function resolveRunnerControlSession(rawToken: string) {
  const [session] = await db()
    .select()
    .from(runnerControlSessions)
    .where(
      and(
        eq(runnerControlSessions.hashedToken, hashOpaqueToken(rawToken)),
        isNull(runnerControlSessions.closedAt),
        gt(runnerControlSessions.expiresAt, sql`now()`),
      ),
    )
    .limit(1);
  return session;
}

export async function enrollRunnerControlSession(params: {
  runnerInstanceId: string;
  provisionerId: string;
  labels: string[];
  capabilities?: RunnerToolCapabilitiesDto | null;
  providerKind: string;
  protocolVersion: string;
}): Promise<void> {
  const updated = await db()
    .update(providerRunners)
    .set({
      labels: [...canonicalizeLabels(params.labels)],
      providerKind: params.providerKind,
      protocolVersion: params.protocolVersion,
      capabilities: params.capabilities ?? null,
      state: 'running',
      reportedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(providerRunners.id, params.runnerInstanceId),
        eq(providerRunners.provisionerId, params.provisionerId),
        notInArray(providerRunners.state, [...terminalStates]),
      ),
    )
    .returning({id: providerRunners.id});
  if (!updated[0]) throw new RunnerControlSessionInvalidError();
  await touchRunnerControlSession(params.runnerInstanceId, params.provisionerId);
}

export async function attachRunnerControlProviderId(params: {
  runnerInstanceId: string;
  provisionerId: string;
  providerRunnerId: string;
}): Promise<boolean> {
  const rows = await db()
    .update(providerRunners)
    .set({providerRunnerId: params.providerRunnerId, updatedAt: sql`now()`})
    .where(
      and(
        eq(providerRunners.id, params.runnerInstanceId),
        eq(providerRunners.provisionerId, params.provisionerId),
        isNull(providerRunners.providerRunnerId),
        notInArray(providerRunners.state, [...terminalStates]),
      ),
    )
    .returning({id: providerRunners.id});
  return rows.length === 1;
}

export async function touchRunnerControlSession(runnerInstanceId: string, provisionerId: string) {
  await db()
    .update(runnerControlSessions)
    .set({lastSeenAt: sql`now()`})
    .where(
      and(
        eq(runnerControlSessions.runnerInstanceId, runnerInstanceId),
        eq(runnerControlSessions.provisionerId, provisionerId),
        isNull(runnerControlSessions.closedAt),
      ),
    );
  await db()
    .update(providerRunners)
    .set({reportedAt: sql`now()`, updatedAt: sql`now()`})
    .where(
      and(
        eq(providerRunners.id, runnerInstanceId),
        eq(providerRunners.provisionerId, provisionerId),
      ),
    );
}
