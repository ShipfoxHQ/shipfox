import {
  AuthStorage,
  type CreateAgentSessionOptions,
  createAgentSession,
  ModelRegistry,
} from '@earendil-works/pi-coding-agent';

type PiThinkingLevel = NonNullable<CreateAgentSessionOptions['thinkingLevel']>;

// pi resolves a model from its registry by (provider, modelId), so a bare id is
// ambiguous on its own. v1 targets Anthropic, so we pin the provider and treat the
// workflow `model` as the Anthropic model id; selecting other providers comes later.
const PROVIDER = 'anthropic';

export interface AgentInvocation {
  readonly cwd: string;
  readonly model: string;
  readonly thinking: string;
  readonly prompt: string;
  readonly signal: AbortSignal;
}

/**
 * Runs the pi coding agent for one step. Resolves when the agent's turn completes and
 * throws on a pi/provider failure or abort, so the caller maps a resolved call to a
 * succeeded step and a thrown call to a failed step.
 *
 * The returned `summary` is the agent's final assistant message, kept runner-local for
 * observability and never sent to the API, so it is optional.
 */
export async function runAgent(invocation: AgentInvocation): Promise<{summary?: string}> {
  const {cwd, model: modelId, thinking, prompt, signal} = invocation;

  // A listener added to an already-aborted signal never fires, so an abort that lands
  // before this point (or during the awaits below) would leave pi running and burning
  // tokens after the step loop has moved on. Guard on entry, then again once the
  // session exists so a mid-creation abort still stops pi.
  if (signal.aborted) throw new Error('Agent step aborted before the pi session started');

  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const model = modelRegistry.find(PROVIDER, modelId);
  if (!model) {
    throw new Error(`Unknown agent model "${modelId}" for provider "${PROVIDER}"`);
  }

  const {session} = await createAgentSession({
    cwd,
    model,
    thinkingLevel: thinking as PiThinkingLevel,
    authStorage,
    modelRegistry,
  });

  // session.abort() returns a promise; a rejected abort must not become an unhandled
  // rejection that crashes the long-lived runner, so swallow it.
  const abortSession = () => {
    Promise.resolve(session.abort()).catch(() => undefined);
  };

  if (signal.aborted) {
    abortSession();
    throw new Error('Agent step aborted during pi session creation');
  }

  signal.addEventListener('abort', abortSession, {once: true});
  try {
    await session.prompt(prompt);
    return {};
  } finally {
    signal.removeEventListener('abort', abortSession);
  }
}
