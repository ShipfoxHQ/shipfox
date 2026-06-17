import type {
  CreateAgentSessionOptions,
  ModelRegistry as PiModelRegistry,
} from '@earendil-works/pi-coding-agent';
import {config} from '#config.js';
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

  // pi reads ANTHROPIC_API_KEY from the environment. Mirror the runner config into
  // the env when set so a configured key reaches pi without a separate credential
  // store. The runner already loads config from the same variable, so this is a
  // no-op in the common case.
  if (config.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY === undefined) {
    process.env.ANTHROPIC_API_KEY = config.ANTHROPIC_API_KEY;
  }

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

  const onAbort = () => {
    void session.abort();
  };
  signal.addEventListener('abort', onAbort, {once: true});
  try {
    await session.prompt(prompt);
    return {};
  } finally {
    signal.removeEventListener('abort', onAbort);
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
