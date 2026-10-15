import type {AuthInterModuleClient} from '@shipfox/api-auth-dto/inter-module';
import type {
  RunnerLifecycleCapabilitiesDto,
  RunnerPlatformDto,
  RunnerToolCapabilitiesDto,
} from '@shipfox/api-runners-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {canonicalizeLabels} from '@shipfox/runner-labels';
import {
  createRunnerSession,
  createRunnerSessionConsumingActivationToken,
  getRunnerSessionById,
} from '#db/runner-sessions.js';
import type {RunnerSession} from './entities/runner-session.js';
import {EmptyRunnerLabelsError} from './errors.js';
import {sanitizeRunnerLabelsOrThrow} from './runner-labels.js';

export interface RegisterRunnerSessionResult {
  session: RunnerSession;
  sessionToken: string;
  mode: 'manual' | 'activation';
  maxClaims: number | null;
}

export type RunnerRegistrationCredential =
  | {
      kind: 'manual';
      registrationTokenId: string;
      workspaceId: string;
    }
  | {kind: 'activation'; activationTokenId: string; workspaceId: string};

export async function registerRunnerSession(params: {
  auth: AuthInterModuleClient;
  credential: RunnerRegistrationCredential;
  labels: string[];
  toolCapabilities: RunnerToolCapabilitiesDto;
  lifecycleCapabilities: RunnerLifecycleCapabilitiesDto;
  platform: RunnerPlatformDto;
}): Promise<RegisterRunnerSessionResult> {
  const labels =
    params.credential.kind === 'manual'
      ? sanitizeRunnerLabelsOrThrow(params.labels, {
          scope: 'manual',
          source: 'manual runner registration',
        })
      : [...canonicalizeLabels(params.labels)];
  if (labels.length === 0) throw new EmptyRunnerLabelsError();

  const mode = params.credential.kind;
  const maxClaims = params.credential.kind === 'manual' ? null : 1;
  const session =
    params.credential.kind === 'manual'
      ? await createRunnerSession({
          workspaceId: params.credential.workspaceId,
          scope: 'workspace',
          registrationTokenId: params.credential.registrationTokenId,
          labels,
          toolCapabilities: params.toolCapabilities,
          lifecycleCapabilities: params.lifecycleCapabilities,
          platform: params.platform,
        })
      : await createRunnerSessionConsumingActivationToken({
          activationTokenId: params.credential.activationTokenId,
          labels,
          toolCapabilities: params.toolCapabilities,
          lifecycleCapabilities: params.lifecycleCapabilities,
          platform: params.platform,
        });
  logger().info(
    {
      runnerSessionId: session.id,
      ...(session.runnerInstanceId ? {runnerInstanceId: session.runnerInstanceId} : {}),
      mode,
    },
    'Runner capability profile registered',
  );

  const {token: sessionToken} = await params.auth.mintRunnerSessionToken({
    runnerSessionId: session.id,
    workspaceId: session.workspaceId,
    scope: session.scope,
    labels: session.labels,
    maxClaims,
    lifecycleCapabilities: session.lifecycleCapabilities,
  });

  return {session, sessionToken, mode, maxClaims};
}

export async function getRunnerSessionPlatform(params: {
  runnerSessionId: string;
}): Promise<RunnerPlatformDto> {
  const runnerSession = await getRunnerSessionById(params.runnerSessionId);
  if (!runnerSession) throw new Error(`Runner session not found: ${params.runnerSessionId}`);
  return runnerSession.platform;
}
