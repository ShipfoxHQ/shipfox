import type {
  CreateAgentSessionOptions,
  ModelRegistry as PiModelRegistry,
} from '@earendil-works/pi-coding-agent';
import type {AgentHarness, AgentInvocation, AgentRunResult} from '#core/agent-harness.js';

type PiModel = NonNullable<CreateAgentSessionOptions['model']>;
type PiThinkingLevel = NonNullable<CreateAgentSessionOptions['thinkingLevel']>;

// pi resolves a model from its registry by (provider, modelId). The workflow `model`
// is free text: "provider/modelId" selects a provider explicitly; a bare id assumes
// Anthropic, matching v1's Anthropic-first default. An unresolvable model throws,
// which the step records as `agent_invocation_failed`.
const DEFAULT_PROVIDER = 'anthropic';

export function createPiAgentHarness(): AgentHarness {
  return {run: runWithPi};
}

async function runWithPi(invocation: AgentInvocation): Promise<AgentRunResult> {
  const {cwd, model: modelSpec, thinking, prompt, signal} = invocation;

  // A listener added to an already-aborted signal never fires, so an abort that
  // lands before this point (or during the awaits below) would leave pi running and
  // burning tokens after the step loop has moved on. Guard on entry, then again once
  // the session exists so a mid-creation abort still stops pi.
  if (signal.aborted) throw new Error('Agent step aborted before the pi session started');

  const {createAgentSession, AuthStorage, ModelRegistry} = await import(
    '@earendil-works/pi-coding-agent'
  );

  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);

  const {session} = await createAgentSession({
    cwd,
    model: resolveModel(modelRegistry, modelSpec),
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

function resolveModel(registry: PiModelRegistry, spec: string): PiModel {
  const separator = spec.indexOf('/');
  const [provider, modelId] =
    separator > 0
      ? [spec.slice(0, separator), spec.slice(separator + 1)]
      : [DEFAULT_PROVIDER, spec];

  const model = registry.find(provider, modelId);
  if (!model) {
    throw new Error(`Unknown agent model "${spec}" (provider "${provider}", model "${modelId}")`);
  }
  return model;
}
