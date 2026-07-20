import type {AuthInterModuleClient} from '@shipfox/api-auth-dto/inter-module';
import type {RunnerToolCapabilitiesDto} from '@shipfox/api-runners-dto';
import {canonicalizeLabels} from '@shipfox/runner-labels';
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
      providerRunnerId: string;
    };

export async function registerRunnerSession(params: {
  auth: AuthInterModuleClient;
  credential: RunnerRegistrationCredential;
  labels: string[];
  toolCapabilities?: RunnerToolCapabilitiesDto | null;
}): Promise<RegisterRunnerSessionResult> {
  const labels = [...canonicalizeLabels(params.labels)];
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
          toolCapabilities: params.toolCapabilities ?? null,
        })
      : await createRunnerSessionConsumingEphemeralToken({
          ephemeralTokenId: params.credential.ephemeralTokenId,
          workspaceId: params.credential.workspaceId,
          labels,
          toolCapabilities: params.toolCapabilities ?? null,
          maxClaims: 1,
        });
  const {token: sessionToken} = await params.auth.mintRunnerSessionToken({
    runnerSessionId: session.id,
    workspaceId: session.workspaceId,
    scope: session.scope,
    labels: session.labels,
    maxClaims,
  });

  return {session, sessionToken, mode, maxClaims};
}
