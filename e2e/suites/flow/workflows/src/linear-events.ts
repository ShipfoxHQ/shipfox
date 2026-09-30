import {
  type LinearIssueFixtureData,
  postLinearAgentSession,
  postLinearIssueUpdate,
} from '@shipfox/e2e-driver-linear';
import {waitForRunByDeliveryId} from '@shipfox/e2e-observe-workflows';

const MAX_TRIGGER_ATTEMPTS = 8;
const RUN_LOOKUP_TIMEOUT_MS = 15_000;

interface LinearTriggerParams {
  projectId: string;
  workspaceId: string;
  token: string;
  organizationId: string;
  issue: LinearIssueFixtureData;
}

export async function triggerLinearIssueUpdateAndAwaitRun(
  params: LinearTriggerParams & {previousStateId: string; actorId: string},
): Promise<{runId: string; deliveryId: string}> {
  return await triggerAndAwaitRun(params, () =>
    postLinearIssueUpdate({
      organizationId: params.organizationId,
      issue: params.issue,
      previousStateId: params.previousStateId,
      actorId: params.actorId,
    }),
  );
}

export async function triggerLinearAgentSessionAndAwaitRun(
  params: LinearTriggerParams & {
    action: 'created' | 'prompted';
    appUserId: string;
    sessionId: string;
    prompt?: string | undefined;
  },
): Promise<{runId: string; deliveryId: string}> {
  return await triggerAndAwaitRun(params, () =>
    postLinearAgentSession({
      action: params.action,
      organizationId: params.organizationId,
      appUserId: params.appUserId,
      sessionId: params.sessionId,
      issue: params.issue,
      prompt: params.prompt,
    }),
  );
}

// A delivery that lands before the definition's subscription activates starts no run, so the
// sender retries until one appears.
async function triggerAndAwaitRun(
  params: LinearTriggerParams,
  post: () => Promise<string>,
): Promise<{runId: string; deliveryId: string}> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_TRIGGER_ATTEMPTS; attempt += 1) {
    const deliveryId = await post();

    try {
      const run = await waitForRunByDeliveryId({
        projectId: params.projectId,
        deliveryId,
        token: params.token,
        timeoutMs: RUN_LOOKUP_TIMEOUT_MS,
        workspaceId: params.workspaceId,
      });
      return {runId: run.id, deliveryId};
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`No run appeared after ${MAX_TRIGGER_ATTEMPTS} signed Linear deliveries.`);
}
