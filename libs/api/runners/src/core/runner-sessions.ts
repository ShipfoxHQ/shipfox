import {issueRunnerSessionToken} from '@shipfox/api-auth';
import {canonicalizeRunnerLabels} from '@shipfox/api-runners-dto';
import {createRunnerSessionConsumingEphemeralToken} from '#db/ephemeral-registration-tokens.js';
import {createRunnerSession} from '#db/runner-sessions.js';
import type {RunnerSession} from './entities/runner-session.js';
import {EmptyRunnerLabelsError} from './errors.js';

export interface RegisterRunnerSessionResult {
  session: RunnerSession;
  sessionToken: string;
  mode: 'manual' | 'ephemeral';
  maxClaims: number | null;
}

export type RunnerRegistrationCredential =
  | {
      kind: 'manual';
      registrationTokenId: string;
      workspaceId: string;
    }
  | {
      kind: 'ephemeral';
      ephemeralTokenId: string;
      workspaceId: string;
      provisionerId: string;
      reservationId: string | null;
      resourceId: string;
    };

export async function registerRunnerSession(params: {
  credential: RunnerRegistrationCredential;
  labels: string[];
}): Promise<RegisterRunnerSessionResult> {
  const labels = canonicalizeRunnerLabels(params.labels);
  if (labels.length === 0) throw new EmptyRunnerLabelsError();

  const mode = params.credential.kind;
  const maxClaims = params.credential.kind === 'ephemeral' ? 1 : null;
  const session =
    params.credential.kind === 'manual'
      ? await createRunnerSession({
          workspaceId: params.credential.workspaceId,
          scope: 'workspace',
          registrationTokenId: params.credential.registrationTokenId,
          labels,
        })
      : await createRunnerSessionConsumingEphemeralToken({
          ephemeralTokenId: params.credential.ephemeralTokenId,
          workspaceId: params.credential.workspaceId,
          labels,
          maxClaims: 1,
        });
  const sessionToken = await issueRunnerSessionToken({
    runnerSessionId: session.id,
    workspaceId: session.workspaceId,
    scope: session.scope,
    labels: session.labels,
    maxClaims,
  });

  return {session, sessionToken, mode, maxClaims};
}
