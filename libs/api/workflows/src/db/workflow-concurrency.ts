import {randomUUID} from 'node:crypto';
import {and, eq, isNull, sql} from 'drizzle-orm';
import type {WorkflowConcurrencyClaim} from '#core/entities/workflow-concurrency-claim.js';
import {
  canonicalizeWorkflowConcurrencyGroup,
  type ResolvedWorkflowConcurrency,
  type WorkflowConcurrencyScope,
  workflowConcurrencyIdentity,
  workflowConcurrencyIdentityKey,
} from '#core/workflow-concurrency.js';
import {
  recordWorkflowConcurrencyClaimOutcome,
  recordWorkflowConcurrencyWaiterSuperseded,
} from '#metrics/instance.js';
import {db, type Tx} from './db.js';
import {
  toWorkflowConcurrencyClaim,
  workflowConcurrencyClaims,
} from './schema/workflow-concurrency-claims.js';

export interface AdmitWorkflowConcurrencyClaimParams {
  readonly projectId: string;
  readonly definitionId: string;
  readonly originScope: string;
  readonly workflowRunId: string;
  readonly workflowRunAttemptId: string;
  readonly concurrency: ResolvedWorkflowConcurrency;
  readonly tx?: Tx | undefined;
}

export interface AdmitWorkflowConcurrencyClaimResult {
  readonly claim: WorkflowConcurrencyClaim;
  readonly supersededClaim: WorkflowConcurrencyClaim | null;
  readonly holderCancellationRequested: boolean;
}

/**
 * Admits one resolved workflow concurrency value under the effective group's transaction lock.
 * This command only changes claim rows and never changes workflow run or attempt status.
 */
export async function admitWorkflowConcurrencyClaim(
  params: AdmitWorkflowConcurrencyClaimParams,
): Promise<AdmitWorkflowConcurrencyClaimResult> {
  const result = params.tx
    ? await admitWorkflowConcurrencyClaimInTransaction(params, params.tx)
    : await db().transaction((tx) => admitWorkflowConcurrencyClaimInTransaction(params, tx));

  if (result.claim.state === 'acquired' || result.claim.state === 'waiting') {
    recordWorkflowConcurrencyClaimOutcome(result.claim.state);
  }
  if (result.supersededClaim) recordWorkflowConcurrencyWaiterSuperseded();
  return result;
}

async function admitWorkflowConcurrencyClaimInTransaction(
  params: AdmitWorkflowConcurrencyClaimParams,
  tx: Tx,
): Promise<AdmitWorkflowConcurrencyClaimResult> {
  const normalizedGroup = canonicalizeWorkflowConcurrencyGroup(params.concurrency.group);
  const identity = workflowConcurrencyIdentity({
    projectId: params.projectId,
    definitionId: params.definitionId,
    originScope: params.originScope,
    concurrency: {...normalizedGroup, scope: params.concurrency.scope},
  });

  // A hash collision only makes unrelated identities wait for one another. Every slot query and
  // unique index still uses the complete identity, so collisions cannot merge groups.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${workflowConcurrencyIdentityKey(identity)}, 0))`,
  );

  const identityConditions = workflowConcurrencyIdentityConditions(identity);
  const [acquiredClaim] = await tx
    .select()
    .from(workflowConcurrencyClaims)
    .where(and(...identityConditions, eq(workflowConcurrencyClaims.state, 'acquired')))
    .limit(1)
    .for('update');
  const [waitingClaim] = await tx
    .select()
    .from(workflowConcurrencyClaims)
    .where(and(...identityConditions, eq(workflowConcurrencyClaims.state, 'waiting')))
    .limit(1)
    .for('update');

  const state = acquiredClaim ? 'waiting' : 'acquired';
  const claimId = randomUUID();
  const now = new Date();
  let supersededClaim: WorkflowConcurrencyClaim | null = null;
  if (waitingClaim) {
    const [updatedWaitingClaim] = await tx
      .update(workflowConcurrencyClaims)
      .set({
        state: 'superseded',
        supersededByClaimId: claimId,
        supersededAt: now,
        stateChangedAt: now,
        updatedAt: now,
      })
      .where(eq(workflowConcurrencyClaims.id, waitingClaim.id))
      .returning();
    if (!updatedWaitingClaim) throw new Error(`Waiting claim disappeared: ${waitingClaim.id}`);
    supersededClaim = toWorkflowConcurrencyClaim(updatedWaitingClaim);
  }

  const [generationRow] = await tx
    .select({
      generation: sql<number>`coalesce(max(${workflowConcurrencyClaims.generation}), 0) + 1`,
    })
    .from(workflowConcurrencyClaims)
    .where(and(...identityConditions));
  const generation = Number(generationRow?.generation ?? 1);

  const [claimRow] = await tx
    .insert(workflowConcurrencyClaims)
    .values({
      id: claimId,
      projectId: identity.projectId,
      originScope: identity.originScope,
      scope: identity.scope,
      definitionId: identity.definitionId,
      displayGroup: normalizedGroup.displayGroup,
      canonicalGroupKey: identity.canonicalGroupKey,
      workflowRunId: params.workflowRunId,
      workflowRunAttemptId: params.workflowRunAttemptId,
      generation,
      cancelInProgress: params.concurrency.cancelInProgress,
      state,
      stateChangedAt: now,
      acquiredAt: state === 'acquired' ? now : null,
      waitingAt: state === 'waiting' ? now : null,
    })
    .returning();
  if (!claimRow) throw new Error('Concurrency claim insert returned no rows');

  let holderCancellationRequested =
    acquiredClaim !== undefined && acquiredClaim.cancellationRequestedAt !== null;
  if (acquiredClaim && params.concurrency.cancelInProgress) {
    const [updatedHolder] = await tx
      .update(workflowConcurrencyClaims)
      .set({
        cancellationRequestedAt: sql`coalesce(${workflowConcurrencyClaims.cancellationRequestedAt}, now())`,
        updatedAt: now,
      })
      .where(
        and(
          eq(workflowConcurrencyClaims.id, acquiredClaim.id),
          isNull(workflowConcurrencyClaims.cancellationRequestedAt),
        ),
      )
      .returning({cancellationRequestedAt: workflowConcurrencyClaims.cancellationRequestedAt});
    holderCancellationRequested = updatedHolder !== undefined || holderCancellationRequested;
  }

  return {
    claim: toWorkflowConcurrencyClaim(claimRow),
    supersededClaim,
    holderCancellationRequested,
  };
}

function workflowConcurrencyIdentityConditions(
  identity: ReturnType<typeof workflowConcurrencyIdentity>,
) {
  return [
    eq(workflowConcurrencyClaims.projectId, identity.projectId),
    eq(workflowConcurrencyClaims.originScope, identity.originScope),
    eq(workflowConcurrencyClaims.scope, identity.scope),
    identity.definitionId === null
      ? isNull(workflowConcurrencyClaims.definitionId)
      : eq(workflowConcurrencyClaims.definitionId, identity.definitionId),
    eq(workflowConcurrencyClaims.canonicalGroupKey, identity.canonicalGroupKey),
  ] as const;
}

export {
  canonicalizeWorkflowConcurrencyGroup,
  workflowConcurrencyIdentity,
  workflowConcurrencyIdentityKey,
} from '#core/workflow-concurrency.js';
export type {WorkflowConcurrencyScope};
