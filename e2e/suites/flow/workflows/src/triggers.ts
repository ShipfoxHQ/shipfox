import type {FireManualTriggerResponseDto} from '@shipfox/api-triggers-dto';
import {type createApiClient, E2eApiError, pollUntil} from '@shipfox/e2e-core';
import {commitFiles} from '@shipfox/e2e-driver-gitea';
import {waitForRunByCommit} from '@shipfox/e2e-observe-workflows';

const MANUAL_TRIGGER_TIMEOUT_MS = 60_000;

export async function triggerPushAndAwaitRun(params: {
  org: string;
  repo: string;
  scenario: string;
  uniqueId: string;
  message?: string | undefined;
  projectId: string;
  token: string;
}): Promise<string> {
  const maxAttempts = 8;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const triggerSha = await commitFiles({
      org: params.org,
      repo: params.repo,
      message: params.message ?? `trigger ${params.scenario} ${params.uniqueId} #${attempt}`,
      files: [
        {
          path: `.shipfox-e2e-trigger-${attempt}`,
          content: `${params.scenario} ${params.uniqueId} ${attempt}\n`,
        },
      ],
    });
    try {
      const run = await waitForRunByCommit({
        projectId: params.projectId,
        headCommitSha: triggerSha,
        token: params.token,
        timeoutMs: 15_000,
      });
      return run.id;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`No run appeared for ${params.scenario} after ${maxAttempts} trigger pushes`);
}

export async function fireManualAndAwaitRun(params: {
  client: ReturnType<typeof createApiClient>;
  definitionId: string;
  inputs: Record<string, unknown>;
  scenario: string;
  timeoutMs?: number | undefined;
}): Promise<string> {
  let lastNotFound: E2eApiError | undefined;
  const response = await pollUntil<FireManualTriggerResponseDto>(
    {
      timeoutMs: params.timeoutMs ?? MANUAL_TRIGGER_TIMEOUT_MS,
      intervalMs: 250,
      maxIntervalMs: 4_000,
      backoffFactor: 1.5,
      describe: () =>
        `manual trigger for ${params.scenario}: definitionId=${params.definitionId}${formatLastNotFound(
          lastNotFound,
        )}`,
    },
    async () => {
      try {
        return await params.client.requestJson<FireManualTriggerResponseDto>(
          'post',
          `/workflow-definitions/${params.definitionId}/fire-manual`,
          {json: {inputs: params.inputs}},
        );
      } catch (error) {
        if (!(error instanceof E2eApiError) || error.status !== 404) throw error;
        lastNotFound = error;
        return null;
      }
    },
  );

  return response.workflow_run_id;
}

function formatLastNotFound(error: E2eApiError | undefined): string {
  if (error === undefined) return '';
  return ` last404=${JSON.stringify(error.details)}`;
}
