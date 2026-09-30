import {type DiscordSlashCommandParams, postDiscordSlashCommand} from '@shipfox/e2e-driver-discord';
import {waitForRunByDeliveryId} from '@shipfox/e2e-observe-workflows';

const MAX_TRIGGER_ATTEMPTS = 8;
const RUN_LOOKUP_TIMEOUT_MS = 15_000;

export async function triggerDiscordSlashCommandAndAwaitRun(
  params: DiscordSlashCommandParams & {
    projectId: string;
    workspaceId: string;
    token: string;
  },
): Promise<{runId: string; interactionId: string; acknowledgement: unknown}> {
  let lastError: unknown;

  // An interaction that lands before the definition's subscription activates starts no run, so the
  // sender retries, each time as a new interaction, until one appears.
  for (let attempt = 1; attempt <= MAX_TRIGGER_ATTEMPTS; attempt += 1) {
    const {interactionId, body} = await postDiscordSlashCommand({
      guildId: params.guildId,
      channelId: params.channelId,
      prompt: params.prompt,
      userId: params.userId,
    });

    try {
      const run = await waitForRunByDeliveryId({
        projectId: params.projectId,
        deliveryId: interactionId,
        token: params.token,
        timeoutMs: RUN_LOOKUP_TIMEOUT_MS,
        workspaceId: params.workspaceId,
      });
      return {runId: run.id, interactionId, acknowledgement: body};
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`No run appeared after ${MAX_TRIGGER_ATTEMPTS} signed Discord interactions.`);
}
