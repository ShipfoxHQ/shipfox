import {and, eq, inArray, isNotNull, isNull, or} from 'drizzle-orm';
import {alias} from 'drizzle-orm/pg-core';
import type {WorkflowRunList} from '#core/entities/workflow-run.js';
import type {WorkflowRunAttempt} from '#core/entities/workflow-run-attempt.js';
import {db} from '../db.js';
import {workflowConcurrencyClaims} from '../schema/workflow-concurrency-claims.js';
import {workflowRunAttempts} from '../schema/workflow-run-attempts.js';

export interface WorkflowRunConcurrencyAffectedAttempt {
  workflowRunId: string;
  workflowRunAttemptId: string;
}

export interface WorkflowRunConcurrencyRead {
  displayGroup: string;
  scope: 'workflow' | 'project';
  state: 'acquired' | 'waiting' | 'superseded' | 'released';
  generation: number;
  cancelInProgress: boolean;
  affectedAttempts: WorkflowRunConcurrencyAffectedAttempt[];
}

export type WorkflowRunAttemptRead = WorkflowRunAttempt & {
  concurrency: WorkflowRunConcurrencyRead | null;
};

interface ConcurrencyClaimRow {
  attemptId: string;
  displayGroup: string;
  scope: WorkflowRunConcurrencyRead['scope'];
  state: WorkflowRunConcurrencyRead['state'];
  generation: number;
  cancelInProgress: boolean;
  affectedWorkflowRunId: string | null;
  affectedWorkflowRunAttemptId: string | null;
}

/**
 * Reads claims and their single linked holder or replacement in one query. Historical claims stay
 * available so a superseded attempt can explain which newer attempt replaced it.
 */
export async function listWorkflowRunConcurrencyByAttemptIds(
  attemptIds: readonly string[],
): Promise<Map<string, WorkflowRunConcurrencyRead>> {
  if (attemptIds.length === 0) return new Map();

  const claim = workflowConcurrencyClaims;
  const relatedClaim = alias(workflowConcurrencyClaims, 'related_concurrency_claim');
  const sameGroup = and(
    eq(relatedClaim.projectId, claim.projectId),
    eq(relatedClaim.originScope, claim.originScope),
    eq(relatedClaim.scope, claim.scope),
    or(
      and(isNull(relatedClaim.definitionId), isNull(claim.definitionId)),
      and(
        isNotNull(relatedClaim.definitionId),
        isNotNull(claim.definitionId),
        eq(relatedClaim.definitionId, claim.definitionId),
      ),
    ),
    eq(relatedClaim.canonicalGroupKey, claim.canonicalGroupKey),
  );
  const relation = or(
    eq(relatedClaim.id, claim.supersededByClaimId),
    and(eq(claim.state, 'waiting'), eq(relatedClaim.state, 'acquired'), sameGroup),
    and(
      eq(claim.state, 'acquired'),
      isNotNull(claim.cancellationRequestedAt),
      eq(relatedClaim.state, 'waiting'),
      sameGroup,
    ),
  );

  const rows = await db()
    .select({
      attemptId: claim.workflowRunAttemptId,
      displayGroup: claim.displayGroup,
      scope: claim.scope,
      state: claim.state,
      generation: claim.generation,
      cancelInProgress: claim.cancelInProgress,
      affectedWorkflowRunId: relatedClaim.workflowRunId,
      affectedWorkflowRunAttemptId: relatedClaim.workflowRunAttemptId,
    })
    .from(claim)
    .leftJoin(relatedClaim, relation)
    .where(inArray(claim.workflowRunAttemptId, [...attemptIds]));

  return toConcurrencyMap(rows);
}

/** Reads the concurrency claim for each current attempt in a run-list page in one batched read. */
export async function listWorkflowRunConcurrencyForRuns(
  runs: readonly Pick<WorkflowRunList, 'id' | 'currentAttempt'>[],
): Promise<Map<string, WorkflowRunConcurrencyRead>> {
  if (runs.length === 0) return new Map();

  const currentAttemptConditions = runs.map((run) =>
    and(
      eq(workflowRunAttempts.workflowRunId, run.id),
      eq(workflowRunAttempts.attempt, run.currentAttempt),
    ),
  );
  const attempts = await db()
    .select({runId: workflowRunAttempts.workflowRunId, attemptId: workflowRunAttempts.id})
    .from(workflowRunAttempts)
    .where(or(...currentAttemptConditions));
  const byAttemptId = await listWorkflowRunConcurrencyByAttemptIds(
    attempts.map((attempt) => attempt.attemptId),
  );
  const result = new Map<string, WorkflowRunConcurrencyRead>();
  for (const attempt of attempts) {
    const concurrency = byAttemptId.get(attempt.attemptId);
    if (concurrency) result.set(attempt.runId, concurrency);
  }
  return result;
}

function toConcurrencyMap(rows: ConcurrencyClaimRow[]): Map<string, WorkflowRunConcurrencyRead> {
  const result = new Map<string, WorkflowRunConcurrencyRead>();
  for (const row of rows) {
    const current = result.get(row.attemptId);
    const affectedAttempt =
      row.affectedWorkflowRunId && row.affectedWorkflowRunAttemptId
        ? {
            workflowRunId: row.affectedWorkflowRunId,
            workflowRunAttemptId: row.affectedWorkflowRunAttemptId,
          }
        : undefined;
    if (current) {
      if (
        affectedAttempt &&
        !current.affectedAttempts.some(
          (attempt) => attempt.workflowRunAttemptId === affectedAttempt.workflowRunAttemptId,
        )
      ) {
        current.affectedAttempts.push(affectedAttempt);
      }
      continue;
    }

    result.set(row.attemptId, {
      displayGroup: row.displayGroup,
      scope: row.scope,
      state: row.state,
      generation: row.generation,
      cancelInProgress: row.cancelInProgress,
      affectedAttempts: affectedAttempt ? [affectedAttempt] : [],
    });
  }
  return result;
}
