import type {RunnerToolCapabilitiesDto} from '@shipfox/api-runners-dto';
import {and, asc, eq, inArray, lt, notExists, or, sql} from 'drizzle-orm';
import type {RunnerSession} from '#core/entities/runner-session.js';
import {db} from './db.js';
import {runnerSessions, toRunnerSession} from './schema/runner-sessions.js';
import {runningJobExecutions} from './schema/running-job-executions.js';

export interface CreateRunnerSessionParams {
  workspaceId: string;
  scope: 'workspace';
  registrationTokenId: string;
  labels: string[];
  toolCapabilities?: RunnerToolCapabilitiesDto | null;
}

export async function createRunnerSession(
  params: CreateRunnerSessionParams,
): Promise<RunnerSession> {
  const rows = await db()
    .insert(runnerSessions)
    .values({
      workspaceId: params.workspaceId,
      scope: params.scope,
      registrationTokenId: params.registrationTokenId,
      registrationTokenKind: 'manual',
      labels: params.labels,
      toolCapabilities: params.toolCapabilities ?? null,
      toolCapabilitiesReportedAt: params.toolCapabilities ? sql`now()` : null,
      maxClaims: null,
      claimsUsed: 0,
    })
    .returning();

  const row = rows[0];
  if (!row) throw new Error('Insert returned no rows');
  return toRunnerSession(row);
}

export async function getRunnerSessionById(runnerSessionId: string): Promise<RunnerSession | null> {
  const rows = await db()
    .select()
    .from(runnerSessions)
    .where(eq(runnerSessions.id, runnerSessionId))
    .limit(1);

  const row = rows[0];
  return row ? toRunnerSession(row) : null;
}

export interface DeleteExpiredRunnerSessionsParams {
  manualRetentionDays: number;
  ephemeralRetentionDays: number;
  limit?: number;
}

export async function deleteExpiredRunnerSessions(
  params: DeleteExpiredRunnerSessionsParams,
): Promise<number> {
  const expiredIds = db()
    .select({id: runnerSessions.id})
    .from(runnerSessions)
    .where(
      and(
        or(
          and(
            eq(runnerSessions.registrationTokenKind, 'manual'),
            lt(
              runnerSessions.createdAt,
              sql`now() - (${params.manualRetentionDays} || ' days')::interval`,
            ),
          ),
          and(
            eq(runnerSessions.registrationTokenKind, 'ephemeral'),
            lt(
              runnerSessions.createdAt,
              sql`now() - (${params.ephemeralRetentionDays} || ' days')::interval`,
            ),
          ),
        ),
        notExists(
          db()
            .select({id: runningJobExecutions.id})
            .from(runningJobExecutions)
            .where(eq(runningJobExecutions.runnerSessionId, runnerSessions.id)),
        ),
      ),
    )
    .orderBy(asc(runnerSessions.createdAt), asc(runnerSessions.id))
    .limit(params.limit ?? 1000);

  const deleted = await db()
    .delete(runnerSessions)
    .where(inArray(runnerSessions.id, expiredIds))
    .returning({id: runnerSessions.id});

  return deleted.length;
}
