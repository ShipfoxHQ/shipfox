import {join} from 'node:path';
import {
  AuthStorage,
  type CreateAgentSessionOptions,
  createAgentSession,
  ModelRegistry,
  SessionManager,
} from '@earendil-works/pi-coding-agent';
import {AgentConfigError} from '#core/errors.js';
import {type SessionForwarder, startSessionForwarder} from '#core/session-forwarder.js';

type PiThinkingLevel = NonNullable<CreateAgentSessionOptions['thinkingLevel']>;

export interface AgentInvocation {
  readonly cwd: string;
  readonly model: string;
  // pi resolves a model from its registry by (provider, modelId), so a bare id is
  // ambiguous on its own; the provider selects which built-in (or models.json) set the
  // model id is looked up in. Free-text, defaulted upstream to anthropic.
  readonly provider: string;
  readonly thinking: string;
  readonly prompt: string;
  readonly signal: AbortSignal;
  /**
   * Forwards each verbatim pi session entry line as it is persisted, in order. Best-effort
   * observability: when absent (or the session is not persisted), forwarding is skipped and
   * the step is unaffected.
   */
  readonly onSessionEntry?: (line: string) => void;
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
  const {cwd, model: modelId, provider, thinking, prompt, signal, onSessionEntry} = invocation;

  // A listener added to an already-aborted signal never fires, so an abort that lands
  // before this point (or during the awaits below) would leave pi running and burning
  // tokens after the step loop has moved on. Guard on entry, then again once the
  // session exists so a mid-creation abort still stops pi.
  if (signal.aborted) throw new Error('Agent step aborted before the pi session started');

  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const model = resolveModel(modelRegistry, provider, modelId);

  // Surface a missing key up front as a config error: otherwise it fails deep inside the
  // provider call as an opaque invocation failure, hiding that the fix is on the runner.
  if (!modelRegistry.hasConfiguredAuth(model)) {
    throw new AgentConfigError(
      `No credentials configured for provider "${provider}" on this runner. ` +
        "Set the provider's API key in the runner environment.",
    );
  }

  const {session} = await createAgentSession({
    cwd,
    model,
    thinkingLevel: thinking as PiThinkingLevel,
    authStorage,
    modelRegistry,
    // Keep the session JSONL inside the job workspace so it forwards from a deterministic path
    // and is cleaned up with the workspace; pi's default lives under ~/.pi, outside it.
    sessionManager: SessionManager.create(cwd, join(cwd, 'logs', 'agent-sessions')),
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
  const forwarder = startForwarding(session.sessionFile, onSessionEntry);
  try {
    await session.prompt(prompt);
    return {};
  } finally {
    // A final synchronous read forwards every entry written before the caller closes the log
    // stream, so all session records precede its end marker.
    forwarder?.stop();
    signal.removeEventListener('abort', abortSession);
  }
}

function startForwarding(
  sessionFile: string | undefined,
  onSessionEntry: ((line: string) => void) | undefined,
): SessionForwarder | undefined {
  if (onSessionEntry === undefined || sessionFile === undefined) return undefined;
  return startSessionForwarder({filePath: sessionFile, onEntry: onSessionEntry});
}

type ResolvedModel = NonNullable<ReturnType<ModelRegistry['find']>>;

// pi's `find` returns undefined for both an unknown provider and a known provider that
// lacks the model, so split them on the registry's provider set to give an actionable
// message (and, when another provider carries the same id, a did-you-mean hint).
function resolveModel(
  modelRegistry: ModelRegistry,
  provider: string,
  modelId: string,
): ResolvedModel {
  const model = modelRegistry.find(provider, modelId);
  if (model) return model;

  const all = modelRegistry.getAll();
  const knownProviders = new Set(all.map((entry) => entry.provider));
  if (!knownProviders.has(provider)) {
    throw new AgentConfigError(
      `Unknown provider "${provider}" for agent step. ` +
        'Known providers are pi built-ins plus any from models.json.',
    );
  }

  const alternativeProvider = all.find((entry) => entry.id === modelId)?.provider;
  const hint =
    alternativeProvider === undefined
      ? ''
      : ` Did you mean to set provider: ${alternativeProvider}?`;
  throw new AgentConfigError(
    `Model "${modelId}" is not available for provider "${provider}".${hint}`,
  );
}
