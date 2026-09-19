import {randomUUID} from 'node:crypto';
import {
  WORKFLOWS_WORKFLOW_CONCURRENCY_ACQUIRED,
  WORKFLOWS_WORKFLOW_RUN_ATTEMPT_CREATED,
} from '@shipfox/api-workflows-dto';
import {and, asc, eq, inArray, isNull, notExists, or, sql} from 'drizzle-orm';
import {alias} from 'drizzle-orm/pg-core';
import {
  transitionWorkflowConcurrencyClaim,
  type WorkflowConcurrencyClaim,
  type WorkflowConcurrencyClaimState,
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
import {writeWorkflowsOutboxEvent} from './outbox-writes.js';
import {workflowsOutbox} from './schema/outbox.js';
import {
  toWorkflowConcurrencyClaim,
  type WorkflowConcurrencyClaimDb,
  workflowConcurrencyClaims,
} from './schema/workflow-concurrency-claims.js';
import {workflowRunAttempts} from './schema/workflow-run-attempts.js';
import {toWorkflowRunOriginState, workflowRuns} from './schema/workflow-runs.js';

const TERMINAL_RUN_STATUSES = ['succeeded', 'failed', 'cancelled'] as const;

export type WorkflowConcurrencyRepairCategory =
  | 'terminal_holder'
  | 'orphaned_group'
  | 'superseded_attempt'
  | 'acquired_without_orchestration';

export interface WorkflowConcurrencyRepairCandidate {
  readonly claimId: string;
  readonly workflowRunId: string;
  readonly workflowRunAttemptId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly definitionId: string;
  readonly attempt: number;
  readonly carryOverFromWorkflowRunAttemptId: string | null;
  readonly claimState: WorkflowConcurrencyClaimState;
  readonly attemptStatus: string;
  readonly runStatus: string;
}

export interface WorkflowConcurrencyRepairResult {
  readonly changed: boolean;
  readonly promotedClaim: WorkflowConcurrencyClaim | null;
}

export interface WorkflowConcurrencyRepairCandidatePage {
  readonly candidates: readonly WorkflowConcurrencyRepairCandidate[];
}

export interface WorkflowRunAttemptConcurrencyAdmission {
  readonly attemptVersion: number;
  readonly claimState: WorkflowConcurrencyClaimState | null;
}

export async function getWorkflowRunAttemptConcurrencyAdmission(
  workflowRunAttemptId: string,
): Promise<WorkflowRunAttemptConcurrencyAdmission | null> {
  const [row] = await db()
    .select({
      attemptVersion: workflowRunAttempts.version,
      claimState: workflowConcurrencyClaims.state,
    })
    .from(workflowRunAttempts)
    .leftJoin(
      workflowConcurrencyClaims,
      eq(workflowConcurrencyClaims.workflowRunAttemptId, workflowRunAttempts.id),
    )
    .where(eq(workflowRunAttempts.id, workflowRunAttemptId))
    .limit(1);
  if (!row) return null;
  return row;
}

export interface WorkflowConcurrencyImpact {
  readonly workflowRunId: string;
  readonly workflowRunAttemptId: string;
  readonly plannedEffect: 'supersede_waiter' | 'cancel_holder';
}

export interface AdmitWorkflowConcurrencyClaimParams {
  readonly workflowRunId: string;
  readonly workflowRunAttemptId: string;
  readonly concurrency: ResolvedWorkflowConcurrency;
  readonly sourceClaim?: WorkflowConcurrencyClaimDb | undefined;
  readonly tx?: Tx | undefined;
}

export interface AdmitWorkflowConcurrencyClaimResult {
  readonly claim: WorkflowConcurrencyClaim;
  readonly supersededClaim: WorkflowConcurrencyClaim | null;
  readonly holderClaim: WorkflowConcurrencyClaim | null;
  readonly holderCancellationRequested: boolean;
  readonly holderCancellationJustRequested: boolean;
  readonly impact: readonly WorkflowConcurrencyImpact[];
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
  const originScope =
    params.sourceClaim?.originScope ??
    workflowConcurrencyOriginScope({
      origin: origin.origin,
      initiatedByUserId: origin.devSource?.initiatedByUserId,
    });
  const normalizedGroup = params.sourceClaim
    ? {
        displayGroup: params.sourceClaim.displayGroup,
        canonicalGroupKey: params.sourceClaim.canonicalGroupKey,
      }
    : canonicalizeWorkflowConcurrencyGroup(params.concurrency.group);
  const concurrency = params.sourceClaim
    ? {
        group: params.sourceClaim.displayGroup,
        scope: params.sourceClaim.scope,
        cancelInProgress: params.sourceClaim.cancelInProgress,
      }
    : params.concurrency;
  const identity = workflowConcurrencyIdentity({
    projectId: participant.projectId,
    definitionId: participant.definitionId,
    originScope,
    concurrency: {...normalizedGroup, scope: concurrency.scope},
  });

  // A hash collision only makes unrelated identities wait for one another. Every slot query and
  // unique index still uses the complete identity, so collisions cannot merge groups.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${workflowConcurrencyIdentityKey(identity)}, 0))`,
  );

  await releaseRerunSourceClaim(params.sourceClaim?.id, tx);

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
  const impact = plannedWorkflowConcurrencyImpact({
    acquiredClaim,
    waitingClaim,
    supersedesWaiter: admission.supersedesWaiter,
    cancelInProgress: concurrency.cancelInProgress,
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
      cancelInProgress: concurrency.cancelInProgress,
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
    requested: concurrency.cancelInProgress,
    now,
  });

  return {
    claim: toWorkflowConcurrencyClaim(claimRow),
    supersededClaim,
    holderClaim: holderCancellation.claim,
    holderCancellationRequested: holderCancellation.requested,
    holderCancellationJustRequested: holderCancellation.justRequested,
    impact,
  };
}

async function releaseRerunSourceClaim(sourceClaimId: string | undefined, tx: Tx): Promise<void> {
  if (!sourceClaimId) return;
  const [sourceClaim] = await tx
    .select()
    .from(workflowConcurrencyClaims)
    .where(eq(workflowConcurrencyClaims.id, sourceClaimId))
    .limit(1)
    .for('update');
  if (!sourceClaim || (sourceClaim.state !== 'acquired' && sourceClaim.state !== 'waiting')) return;

  const now = new Date();
  const [releasedClaim] = await tx
    .update(workflowConcurrencyClaims)
    .set({
      state: transitionWorkflowConcurrencyClaim(sourceClaim.state, 'release'),
      releasedAt: now,
      stateChangedAt: now,
      updatedAt: now,
    })
    .where(eq(workflowConcurrencyClaims.id, sourceClaim.id))
    .returning({id: workflowConcurrencyClaims.id});
  if (!releasedClaim) throw new Error(`Rerun source claim disappeared: ${sourceClaim.id}`);
}

function plannedWorkflowConcurrencyImpact(params: {
  readonly acquiredClaim: WorkflowConcurrencyClaimDb | undefined;
  readonly waitingClaim: WorkflowConcurrencyClaimDb | undefined;
  readonly supersedesWaiter: boolean;
  readonly cancelInProgress: boolean;
}): WorkflowConcurrencyImpact[] {
  const impact: WorkflowConcurrencyImpact[] = [];
  if (params.supersedesWaiter && params.waitingClaim) {
    impact.push({
      workflowRunId: params.waitingClaim.workflowRunId,
      workflowRunAttemptId: params.waitingClaim.workflowRunAttemptId,
      plannedEffect: 'supersede_waiter',
    });
  }
  if (
    params.cancelInProgress &&
    params.acquiredClaim &&
    params.acquiredClaim.cancellationRequestedAt === null
  ) {
    impact.push({
      workflowRunId: params.acquiredClaim.workflowRunId,
      workflowRunAttemptId: params.acquiredClaim.workflowRunAttemptId,
      plannedEffect: 'cancel_holder',
    });
  }
  return impact;
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

export async function listWorkflowConcurrencyRepairCandidates(
  limit: number,
): Promise<WorkflowConcurrencyRepairCandidatePage> {
  const acquiredClaims = alias(workflowConcurrencyClaims, 'repair_acquired_claim');
  const sourceAttempts = alias(workflowRunAttempts, 'repair_source_attempt');
  const rows = await db()
    .select({
      claimId: workflowConcurrencyClaims.id,
      workflowRunId: workflowConcurrencyClaims.workflowRunId,
      workflowRunAttemptId: workflowConcurrencyClaims.workflowRunAttemptId,
      workspaceId: workflowRuns.workspaceId,
      projectId: workflowConcurrencyClaims.projectId,
      definitionId: workflowRuns.definitionId,
      attempt: workflowRunAttempts.attempt,
      carryOverFromWorkflowRunAttemptId: sourceAttempts.id,
      claimState: workflowConcurrencyClaims.state,
      attemptStatus: workflowRunAttempts.status,
      runStatus: workflowRuns.status,
    })
    .from(workflowConcurrencyClaims)
    .innerJoin(
      workflowRunAttempts,
      eq(workflowRunAttempts.id, workflowConcurrencyClaims.workflowRunAttemptId),
    )
    .innerJoin(workflowRuns, eq(workflowRuns.id, workflowConcurrencyClaims.workflowRunId))
    .leftJoin(
      sourceAttempts,
      and(
        eq(workflowRunAttempts.rerunMode, 'failed'),
        eq(sourceAttempts.workflowRunId, workflowRunAttempts.workflowRunId),
        sql`${sourceAttempts.attempt} = ${workflowRunAttempts.attempt} - 1`,
      ),
    )
    .where(
      or(
        and(
          eq(workflowConcurrencyClaims.state, 'acquired'),
          or(
            inArray(workflowRunAttempts.status, TERMINAL_RUN_STATUSES),
            inArray(workflowRuns.status, TERMINAL_RUN_STATUSES),
            and(
              inArray(workflowRunAttempts.status, ['pending', 'waiting']),
              notExists(
                db()
                  .select({id: workflowsOutbox.id})
                  .from(workflowsOutbox)
                  .where(
                    and(
                      eq(workflowsOutbox.eventType, WORKFLOWS_WORKFLOW_RUN_ATTEMPT_CREATED),
                      sql`${workflowsOutbox.payload} ->> 'workflowRunAttemptId' = ${workflowRunAttempts.id}::text`,
                      isNull(workflowsOutbox.dispatchedAt),
                      isNull(workflowsOutbox.deadLetteredAt),
                    ),
                  ),
              ),
            ),
          ),
        ),
        and(
          eq(workflowConcurrencyClaims.state, 'waiting'),
          notExists(
            db()
              .select({id: acquiredClaims.id})
              .from(acquiredClaims)
              .where(
                and(
                  eq(acquiredClaims.projectId, workflowConcurrencyClaims.projectId),
                  eq(acquiredClaims.originScope, workflowConcurrencyClaims.originScope),
                  eq(acquiredClaims.scope, workflowConcurrencyClaims.scope),
                  or(
                    and(
                      isNull(acquiredClaims.definitionId),
                      isNull(workflowConcurrencyClaims.definitionId),
                    ),
                    eq(acquiredClaims.definitionId, workflowConcurrencyClaims.definitionId),
                  ),
                  eq(acquiredClaims.canonicalGroupKey, workflowConcurrencyClaims.canonicalGroupKey),
                  eq(acquiredClaims.state, 'acquired'),
                ),
              ),
          ),
        ),
        and(
          eq(workflowConcurrencyClaims.state, 'superseded'),
          sql`${workflowRunAttempts.status} not in ('succeeded', 'failed', 'cancelled')`,
        ),
      ),
    )
    .orderBy(asc(workflowConcurrencyClaims.updatedAt), asc(workflowConcurrencyClaims.id))
    .limit(Math.max(0, limit));

  return {candidates: rows};
}

/**
 * Releases a terminal holder and promotes the current waiter under the group lock. It is safe to
 * retry after either the transaction or its follow-up outbox delivery has completed.
 */
export function releaseWorkflowConcurrencyClaimForAttempt(
  workflowRunAttemptId: string,
): Promise<WorkflowConcurrencyRepairResult> {
  return db().transaction((tx) =>
    releaseWorkflowConcurrencyClaimForAttemptInTransaction(workflowRunAttemptId, tx),
  );
}

async function releaseWorkflowConcurrencyClaimForAttemptInTransaction(
  workflowRunAttemptId: string,
  tx: Tx,
): Promise<WorkflowConcurrencyRepairResult> {
  const [claimReference] = await tx
    .select()
    .from(workflowConcurrencyClaims)
    .where(eq(workflowConcurrencyClaims.workflowRunAttemptId, workflowRunAttemptId))
    .limit(1);
  if (claimReference?.state !== 'acquired' && claimReference?.state !== 'waiting') {
    return {changed: false, promotedClaim: null};
  }

  await lockWorkflowConcurrencyGroup(claimReference, tx);
  const [claim] = await tx
    .select()
    .from(workflowConcurrencyClaims)
    .innerJoin(
      workflowRunAttempts,
      eq(workflowRunAttempts.id, workflowConcurrencyClaims.workflowRunAttemptId),
    )
    .innerJoin(workflowRuns, eq(workflowRuns.id, workflowConcurrencyClaims.workflowRunId))
    .where(eq(workflowConcurrencyClaims.id, claimReference.id))
    .limit(1);
  if (
    claim?.workflow_concurrency_claims.state !== 'acquired' &&
    claim?.workflow_concurrency_claims.state !== 'waiting'
  ) {
    return {changed: false, promotedClaim: null};
  }
  const claimRow = claim.workflow_concurrency_claims;
  const attemptRow = claim.workflow_run_attempts;
  const runRow = claim.workflow_runs;
  if (
    !TERMINAL_RUN_STATUSES.includes(attemptRow.status as (typeof TERMINAL_RUN_STATUSES)[number]) &&
    !TERMINAL_RUN_STATUSES.includes(runRow.status as (typeof TERMINAL_RUN_STATUSES)[number])
  ) {
    return {changed: false, promotedClaim: null};
  }

  const now = new Date();
  await tx
    .update(workflowConcurrencyClaims)
    .set({state: 'released', releasedAt: now, stateChangedAt: now, updatedAt: now})
    .where(eq(workflowConcurrencyClaims.id, claimRow.id));

  if (claimRow.state === 'waiting') {
    return {changed: true, promotedClaim: null};
  }

  const [waitingClaim] = await tx
    .select()
    .from(workflowConcurrencyClaims)
    .where(
      and(
        ...workflowConcurrencyIdentityConditions({
          projectId: claimRow.projectId,
          originScope: claimRow.originScope,
          scope: claimRow.scope,
          definitionId: claimRow.definitionId,
          canonicalGroupKey: claimRow.canonicalGroupKey,
        }),
        eq(workflowConcurrencyClaims.state, 'waiting'),
      ),
    )
    .orderBy(asc(workflowConcurrencyClaims.generation))
    .limit(1)
    .for('update');

  const promotedClaim =
    waitingClaim && !(await isWorkflowConcurrencyClaimTerminal(waitingClaim, tx))
      ? await promoteWorkflowConcurrencyClaim(waitingClaim, now, tx)
      : null;
  if (waitingClaim && !promotedClaim) {
    await tx
      .update(workflowConcurrencyClaims)
      .set({state: 'released', releasedAt: now, stateChangedAt: now, updatedAt: now})
      .where(eq(workflowConcurrencyClaims.id, waitingClaim.id));
  }
  if (promotedClaim) {
    await writeWorkflowConcurrencyAcquiredEvent(tx, promotedClaim);
  }
  return {changed: true, promotedClaim};
}

/** Promotes a waiter only when its effective group currently has no acquired holder. */
export function promoteWorkflowConcurrencyWaiter(
  workflowConcurrencyClaimId: string,
): Promise<WorkflowConcurrencyRepairResult> {
  return db().transaction((tx) =>
    promoteWorkflowConcurrencyWaiterInTransaction(workflowConcurrencyClaimId, tx),
  );
}

async function promoteWorkflowConcurrencyWaiterInTransaction(
  workflowConcurrencyClaimId: string,
  tx: Tx,
): Promise<WorkflowConcurrencyRepairResult> {
  const [waitingClaim] = await tx
    .select()
    .from(workflowConcurrencyClaims)
    .where(eq(workflowConcurrencyClaims.id, workflowConcurrencyClaimId))
    .limit(1);
  if (waitingClaim?.state !== 'waiting') {
    return {changed: false, promotedClaim: null};
  }

  await lockWorkflowConcurrencyGroup(waitingClaim, tx);
  const [acquiredClaim] = await tx
    .select({id: workflowConcurrencyClaims.id})
    .from(workflowConcurrencyClaims)
    .where(
      and(
        ...workflowConcurrencyIdentityConditions(waitingClaim),
        eq(workflowConcurrencyClaims.state, 'acquired'),
      ),
    )
    .limit(1);
  if (acquiredClaim) return {changed: false, promotedClaim: null};

  const [currentWaitingClaim] = await tx
    .select()
    .from(workflowConcurrencyClaims)
    .where(eq(workflowConcurrencyClaims.id, waitingClaim.id))
    .limit(1)
    .for('update');
  if (currentWaitingClaim?.state !== 'waiting') {
    return {changed: false, promotedClaim: null};
  }
  if (await isWorkflowConcurrencyClaimTerminal(currentWaitingClaim, tx)) {
    const now = new Date();
    await tx
      .update(workflowConcurrencyClaims)
      .set({state: 'released', releasedAt: now, stateChangedAt: now, updatedAt: now})
      .where(eq(workflowConcurrencyClaims.id, currentWaitingClaim.id));
    return {changed: true, promotedClaim: null};
  }
  const promotedClaim = await promoteWorkflowConcurrencyClaim(currentWaitingClaim, new Date(), tx);
  await writeWorkflowConcurrencyAcquiredEvent(tx, promotedClaim);
  return {changed: true, promotedClaim};
}

async function lockWorkflowConcurrencyGroup(
  claim: typeof workflowConcurrencyClaims.$inferSelect,
  tx: Tx,
): Promise<void> {
  const identity = {
    projectId: claim.projectId,
    originScope: claim.originScope,
    scope: claim.scope,
    definitionId: claim.definitionId,
    canonicalGroupKey: claim.canonicalGroupKey,
  };
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${workflowConcurrencyIdentityKey(identity)}, 0))`,
  );
}

async function promoteWorkflowConcurrencyClaim(
  claim: typeof workflowConcurrencyClaims.$inferSelect,
  now: Date,
  tx: Tx,
): Promise<WorkflowConcurrencyClaim> {
  const [updated] = await tx
    .update(workflowConcurrencyClaims)
    .set({state: 'acquired', acquiredAt: now, stateChangedAt: now, updatedAt: now})
    .where(eq(workflowConcurrencyClaims.id, claim.id))
    .returning();
  if (!updated) throw new Error(`Waiting concurrency claim disappeared: ${claim.id}`);
  return toWorkflowConcurrencyClaim(updated);
}

async function isWorkflowConcurrencyClaimTerminal(
  claim: typeof workflowConcurrencyClaims.$inferSelect,
  tx: Tx,
): Promise<boolean> {
  const [statuses] = await tx
    .select({attemptStatus: workflowRunAttempts.status, runStatus: workflowRuns.status})
    .from(workflowRunAttempts)
    .innerJoin(workflowRuns, eq(workflowRuns.id, workflowRunAttempts.workflowRunId))
    .where(
      and(
        eq(workflowRunAttempts.id, claim.workflowRunAttemptId),
        eq(workflowRuns.id, claim.workflowRunId),
      ),
    )
    .limit(1);
  if (!statuses) return false;
  return (
    TERMINAL_RUN_STATUSES.includes(
      statuses.attemptStatus as (typeof TERMINAL_RUN_STATUSES)[number],
    ) ||
    TERMINAL_RUN_STATUSES.includes(statuses.runStatus as (typeof TERMINAL_RUN_STATUSES)[number])
  );
}

async function writeWorkflowConcurrencyAcquiredEvent(
  tx: Tx,
  claim: WorkflowConcurrencyClaim,
): Promise<void> {
  await writeWorkflowsOutboxEvent(tx, {
    type: WORKFLOWS_WORKFLOW_CONCURRENCY_ACQUIRED,
    payload: {
      projectId: claim.projectId,
      claimId: claim.id,
      workflowRunId: claim.workflowRunId,
      workflowRunAttemptId: claim.workflowRunAttemptId,
    },
  });
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
