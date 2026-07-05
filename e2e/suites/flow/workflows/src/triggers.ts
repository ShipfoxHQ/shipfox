import {setTimeout as delay} from 'node:timers/promises';
import type {FireManualTriggerResponseDto} from '@shipfox/api-triggers-dto';
import {type createApiClient, E2eApiError} from '@shipfox/e2e-core';
import {commitFiles} from '@shipfox/e2e-driver-gitea';
import {waitForRunByCommit} from '@shipfox/e2e-observe-workflows';

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
}): Promise<string> {
  const maxAttempts = 8;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await params.client.requestJson<FireManualTriggerResponseDto>(
        'post',
        `/workflow-definitions/${params.definitionId}/fire-manual`,
        {json: {inputs: params.inputs}},
      );
      return response.workflow_run_id;
    } catch (error) {
      if (!(error instanceof E2eApiError) || error.status !== 404) throw error;
      lastError = error;
      await delay(500);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(
        `Manual trigger for ${params.scenario} was not ready after ${maxAttempts} attempts`,
      );
}
