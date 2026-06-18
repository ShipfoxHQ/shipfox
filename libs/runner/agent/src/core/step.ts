import type {StepDto, StepErrorDtoShape, StepErrorReason} from '@shipfox/api-workflows-dto';
import type {StepResult} from '@shipfox/runner-execution';
import {AgentConfigError} from '#core/errors.js';
import {runAgent} from '#core/run-agent.js';

const DEFAULT_THINKING = 'high';
// Matches DEFAULT_AGENT_PROVIDER upstream; kept local so the runner stays decoupled from
// the workflow-document package, and so a config materialized before `provider` existed
// still resolves to anthropic.
const DEFAULT_PROVIDER = 'anthropic';

export function executeAgentStep(
  step: StepDto,
  options: {signal?: AbortSignal; cwd?: string} = {},
): Promise<StepResult> {
  if (step.type !== 'agent') {
    return Promise.resolve(agentFailure(`Unsupported step type: ${step.type}`));
  }

  const {model, prompt, thinking, provider} = step.config;
  if (typeof model !== 'string' || model === '' || typeof prompt !== 'string' || prompt === '') {
    return Promise.resolve(
      agentFailure('Agent step config is missing model or prompt', 'agent_config_invalid'),
    );
  }

  return runAgentStep({
    cwd: options.cwd ?? process.cwd(),
    model,
    prompt,
    thinking: typeof thinking === 'string' ? thinking : DEFAULT_THINKING,
    provider: typeof provider === 'string' && provider !== '' ? provider : DEFAULT_PROVIDER,
    signal: options.signal,
  });
}

async function runAgentStep(params: {
  cwd: string;
  model: string;
  prompt: string;
  thinking: string;
  provider: string;
  signal: AbortSignal | undefined;
}): Promise<StepResult> {
  const {cwd, model, prompt, thinking, provider} = params;
  const signal = params.signal ?? new AbortController().signal;

  try {
    const {summary} = await raceAbort(
      runAgent({cwd, model, provider, thinking, prompt, signal}),
      signal,
    );
    return {success: true, output: summary ?? '', error: null, exit_code: 0};
  } catch (error) {
    const reason: StepErrorReason =
      error instanceof AgentConfigError ? 'agent_config_invalid' : 'agent_invocation_failed';
    return agentFailure(error instanceof Error ? error.message : String(error), reason);
  }
}

// pi has no built-in timeout and may not reject session.prompt() the instant we
// abort. Racing the runAgent call against the abort signal guarantees the step loop
// reaches its abort-before-report guard in seconds instead of hanging until lease
// expiry; runAgent still calls session.abort() to stop the agent's own work.
function raceAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    // `work` (the runAgent call) is already in flight; attach a no-op catch so its
    // eventual rejection can't surface as an unhandled rejection on the aborted path.
    void work.catch(() => undefined);
    return Promise.reject(abortError());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, {once: true});
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function abortError(): Error {
  const error = new Error('Agent step aborted');
  error.name = 'AbortError';
  return error;
}

// Agent-step failures split into a user-fixable config error (`agent_config_invalid`)
// and a genuine provider/API failure (`agent_invocation_failed`, the default); the
// server derives the `user` category from the step type for both. An aborted step never
// reaches the API: the step loop returns before reporting once the signal fires.
function agentFailure(
  message: string,
  reason: StepErrorReason = 'agent_invocation_failed',
): StepResult {
  const error: StepErrorDtoShape = {message, reason};
  return {success: false, output: '', error, exit_code: null};
}
