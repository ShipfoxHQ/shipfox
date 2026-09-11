import {randomUUID} from 'node:crypto';
import {and, eq, isNull, sql} from 'drizzle-orm';
import {
  transitionWorkflowConcurrencyClaim,
  type WorkflowConcurrencyClaim,
} from '#core/entities/workflow-concurrency-claim.js';
import {
  canonicalizeWorkflowConcurrencyGroup,
  nextWorkflowConcurrencyAdmission,
  type ResolvedWorkflowConcurrency,
  type WorkflowConcurrencyScope,
  workflowConcurrencyIdentity,
  workflowConcurrencyIdentityKey,
  workflowConcurrencyOriginScope,
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
import {workflowRunAttempts} from './schema/workflow-run-attempts.js';
import {toWorkflowRunOriginState, workflowRuns} from './schema/workflow-runs.js';

export interface AdmitWorkflowConcurrencyClaimParams {
  readonly workflowRunId: string;
  readonly workflowRunAttemptId: string;
  readonly concurrency: ResolvedWorkflowConcurrency;
  readonly tx?: Tx | undefined;
}

export interface AdmitWorkflowConcurrencyClaimResult {
  readonly claim: WorkflowConcurrencyClaim;
  readonly supersededClaim: WorkflowConcurrencyClaim | null;
  readonly holderClaim: WorkflowConcurrencyClaim | null;
  readonly holderCancellationRequested: boolean;
  readonly holderCancellationJustRequested: boolean;
}

/**
 * Admits one resolved workflow concurrency value under the effective group's transaction lock.
 * This command only changes claim rows and never changes workflow run or attempt status.
 * A caller-provided transaction owns post-commit metric recording from the returned result.
 */
export async function admitWorkflowConcurrencyClaim(
  params: AdmitWorkflowConcurrencyClaimParams,
): Promise<AdmitWorkflowConcurrencyClaimResult> {
  const result = params.tx
    ? await admitWorkflowConcurrencyClaimInTransaction(params, params.tx)
    : await db().transaction((tx) => admitWorkflowConcurrencyClaimInTransaction(params, tx));

  if (!params.tx) recordWorkflowConcurrencyAdmissionMetrics(result);
  return result;
}

async function admitWorkflowConcurrencyClaimInTransaction(
  params: AdmitWorkflowConcurrencyClaimParams,
  tx: Tx,
): Promise<AdmitWorkflowConcurrencyClaimResult> {
  const [participant] = await tx
    .select({
      projectId: workflowRuns.projectId,
      definitionId: workflowRuns.definitionId,
      origin: workflowRuns.origin,
      devSource: workflowRuns.devSource,
    })
    .from(workflowRunAttempts)
    .innerJoin(workflowRuns, eq(workflowRunAttempts.workflowRunId, workflowRuns.id))
    .where(
      and(
        eq(workflowRunAttempts.id, params.workflowRunAttemptId),
        eq(workflowRuns.id, params.workflowRunId),
      ),
    )
    .limit(1);
  if (!participant) {
    throw new Error(
      `Workflow run attempt ${params.workflowRunAttemptId} does not belong to run ${params.workflowRunId}`,
    );
  }
  const origin = toWorkflowRunOriginState(participant);
  const originScope = workflowConcurrencyOriginScope({
    origin: origin.origin,
    initiatedByUserId: origin.devSource?.initiatedByUserId,
  });
  const normalizedGroup = canonicalizeWorkflowConcurrencyGroup(params.concurrency.group);
  const identity = workflowConcurrencyIdentity({
    projectId: participant.projectId,
    definitionId: participant.definitionId,
    originScope,
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

  const admission = nextWorkflowConcurrencyAdmission({
    hasAcquiredClaim: acquiredClaim !== undefined,
    hasWaitingClaim: waitingClaim !== undefined,
  });
  const claimId = randomUUID();
  const now = new Date();
  let supersededClaim: WorkflowConcurrencyClaim | null = null;
  if (admission.supersedesWaiter) {
    if (!waitingClaim) throw new Error('Concurrency admission selected a missing waiter');
    const [updatedWaitingClaim] = await tx
      .update(workflowConcurrencyClaims)
      .set({
        state: transitionWorkflowConcurrencyClaim(waitingClaim.state, 'supersede'),
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
      state: admission.state,
      stateChangedAt: now,
      acquiredAt: admission.state === 'acquired' ? now : null,
      waitingAt: admission.state === 'waiting' ? now : null,
    })
    .returning();
  if (!claimRow) throw new Error('Concurrency claim insert returned no rows');

  const holderCancellation = await requestHolderCancellation({
    tx,
    holder: acquiredClaim,
    requested: params.concurrency.cancelInProgress,
    now,
  });

  return {
    claim: toWorkflowConcurrencyClaim(claimRow),
    supersededClaim,
    holderClaim: holderCancellation.claim,
    holderCancellationRequested: holderCancellation.requested,
    holderCancellationJustRequested: holderCancellation.justRequested,
  };
}

async function requestHolderCancellation(params: {
  readonly tx: Tx;
  readonly holder: typeof workflowConcurrencyClaims.$inferSelect | undefined;
  readonly requested: boolean;
  readonly now: Date;
}): Promise<{
  readonly claim: WorkflowConcurrencyClaim | null;
  readonly requested: boolean;
  readonly justRequested: boolean;
}> {
  if (!params.holder) return {claim: null, requested: false, justRequested: false};

  const holder = toWorkflowConcurrencyClaim(params.holder);
  if (!params.requested) {
    return {
      claim: holder.cancellationRequestedAt === null ? null : holder,
      requested: holder.cancellationRequestedAt !== null,
      justRequested: false,
    };
  }

  const [updatedHolder] = await params.tx
    .update(workflowConcurrencyClaims)
    .set({cancellationRequestedAt: params.now, updatedAt: params.now})
    .where(
      and(
        eq(workflowConcurrencyClaims.id, params.holder.id),
        isNull(workflowConcurrencyClaims.cancellationRequestedAt),
      ),
    )
    .returning({cancellationRequestedAt: workflowConcurrencyClaims.cancellationRequestedAt});
  const justRequested = updatedHolder !== undefined;
  const holderClaim = justRequested
    ? {...holder, cancellationRequestedAt: params.now, updatedAt: params.now}
    : holder;
  return {
    claim: holderClaim,
    requested: justRequested || holder.cancellationRequestedAt !== null,
    justRequested,
  };
}

export function recordWorkflowConcurrencyAdmissionMetrics(
  result: AdmitWorkflowConcurrencyClaimResult,
): void {
  if (result.claim.state === 'acquired' || result.claim.state === 'waiting') {
    recordWorkflowConcurrencyClaimOutcome(result.claim.state);
  }
  if (result.supersededClaim) recordWorkflowConcurrencyWaiterSuperseded();
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
