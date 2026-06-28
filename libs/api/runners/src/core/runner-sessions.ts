import {issueRunnerSessionToken} from '@shipfox/api-auth';
import {canonicalizeRunnerLabels} from '@shipfox/api-runners-dto';
import {createRunnerSession} from '#db/runner-sessions.js';
import type {RunnerSession} from './entities/runner-session.js';
import {EmptyRunnerLabelsError} from './errors.js';

export interface RegisterRunnerSessionResult {
  session: RunnerSession;
  sessionToken: string;
  mode: 'manual';
  maxClaims: null;
}

export async function registerRunnerSession(params: {
  registrationTokenId: string;
  workspaceId: string;
  labels: string[];
}): Promise<RegisterRunnerSessionResult> {
  const labels = canonicalizeRunnerLabels(params.labels);
  if (labels.length === 0) throw new EmptyRunnerLabelsError();

  const session = await createRunnerSession({
    workspaceId: params.workspaceId,
    scope: 'workspace',
    registrationTokenId: params.registrationTokenId,
    labels,
  });
  const sessionToken = await issueRunnerSessionToken({
    runnerSessionId: session.id,
    workspaceId: session.workspaceId,
    scope: session.scope,
    labels: session.labels,
  });

  return {session, sessionToken, mode: 'manual', maxClaims: null};
}
