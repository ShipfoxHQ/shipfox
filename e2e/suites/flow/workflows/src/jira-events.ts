import {type JiraIssueEventParams, postJiraIssueEvent} from '@shipfox/e2e-driver-jira';
import {waitForRunByDeliveryId} from '@shipfox/e2e-observe-workflows';

const MAX_TRIGGER_ATTEMPTS = 8;
const RUN_LOOKUP_TIMEOUT_MS = 15_000;

export async function triggerJiraIssueEventAndAwaitRun(
  params: JiraIssueEventParams & {
    connectionId: string;
    projectId: string;
    workspaceId: string;
    token: string;
  },
): Promise<{runId: string; deliveryId: string}> {
  let lastError: unknown;

  // A delivery that lands before the definition's subscription activates starts no run, so the
  // sender retries until one appears.
  for (let attempt = 1; attempt <= MAX_TRIGGER_ATTEMPTS; attempt += 1) {
    const deliveryId = await postJiraIssueEvent(params);

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
    : new Error(`No run appeared after ${MAX_TRIGGER_ATTEMPTS} signed Jira deliveries.`);
}
