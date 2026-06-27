import type {RunnerSession} from '#core/entities/runner-session.js';
import {db} from './db.js';
import {runnerSessions, toRunnerSession} from './schema/runner-sessions.js';

export interface CreateRunnerSessionParams {
  workspaceId: string;
  scope: 'workspace';
  registrationTokenId: string;
  labels: string[];
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
      labels: params.labels,
    })
    .returning();

  const row = rows[0];
  if (!row) throw new Error('Insert returned no rows');
  return toRunnerSession(row);
}
