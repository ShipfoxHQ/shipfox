import {postSlackAppMention} from '@shipfox/e2e-driver-slack';
import {waitForRunByDeliveryId} from '@shipfox/e2e-observe-workflows';

const MAX_TRIGGER_ATTEMPTS = 8;
const RUN_LOOKUP_TIMEOUT_MS = 15_000;

export async function triggerSlackAppMentionAndAwaitRun(params: {
  projectId: string;
  workspaceId: string;
  token: string;
  teamId: string;
  channel: string;
  ts: string;
  user: string;
  text: string;
}): Promise<{runId: string; eventId: string; channel: string; ts: string}> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_TRIGGER_ATTEMPTS; attempt += 1) {
    const eventId = await postSlackAppMention(params);

    try {
      const run = await waitForRunByDeliveryId({
        projectId: params.projectId,
        deliveryId: eventId,
        token: params.token,
        timeoutMs: RUN_LOOKUP_TIMEOUT_MS,
        workspaceId: params.workspaceId,
      });
      return {runId: run.id, eventId, channel: params.channel, ts: params.ts};
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`No run appeared after ${MAX_TRIGGER_ATTEMPTS} signed Slack app mentions.`);
}
