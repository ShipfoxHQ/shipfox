import type {LinearApiClient} from '#api/client.js';
import type {LinearTokenStore} from '#core/tokens.js';

/** Linear marks a session unresponsive without an activity within 10 seconds of `created`. */
const ACKNOWLEDGEMENT_TIMEOUT_MS = 6_000;
const ACKNOWLEDGEMENT_BODY = 'Looking into this.';

export type AcknowledgeLinearAgentSession = (input: {
  connectionId: string;
  agentSessionId: string;
}) => Promise<void>;

export function createLinearAgentSessionAcknowledger(options: {
  linear: Pick<LinearApiClient, 'createAgentActivity'>;
  tokenStore: Pick<LinearTokenStore, 'getAccessToken'>;
}): AcknowledgeLinearAgentSession {
  return async ({connectionId, agentSessionId}) => {
    const accessToken = await options.tokenStore.getAccessToken({connectionId});
    await options.linear.createAgentActivity({
      accessToken,
      agentSessionId,
      content: {type: 'thought', body: ACKNOWLEDGEMENT_BODY},
      timeoutMs: ACKNOWLEDGEMENT_TIMEOUT_MS,
    });
  };
}
