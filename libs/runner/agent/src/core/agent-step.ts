import type {StepDto, StepErrorDtoShape} from '@shipfox/api-workflows-dto';
import type {StepResult} from '@shipfox/runner-execution';
import type {AgentHarness} from '#core/agent-harness.js';
import {createPiAgentHarness} from '#core/pi-agent-harness.js';

const DEFAULT_THINKING = 'high';

export function executeAgentStep(
  step: StepDto,
  options: {signal?: AbortSignal; cwd?: string; harness?: AgentHarness} = {},
): Promise<StepResult> {
  if (step.type !== 'agent') {
    return Promise.resolve(agentFailure(`Unsupported step type: ${step.type}`));
  }

  const {model, prompt, thinking} = step.config;
  if (typeof model !== 'string' || model === '' || typeof prompt !== 'string' || prompt === '') {
    return Promise.resolve(agentFailure('Agent step config is missing model or prompt'));
  }

  return runAgentStep({
    harness: options.harness ?? createPiAgentHarness(),
    cwd: options.cwd ?? process.cwd(),
    model,
    prompt,
    thinking: typeof thinking === 'string' ? thinking : DEFAULT_THINKING,
    signal: options.signal,
  });
}

async function runAgentStep(params: {
  harness: AgentHarness;
  cwd: string;
  model: string;
  prompt: string;
  thinking: string;
  signal: AbortSignal | undefined;
}): Promise<StepResult> {
  const {harness, cwd, model, prompt, thinking} = params;
  const signal = params.signal ?? new AbortController().signal;

  try {
    const {summary} = await raceAbort(harness.run({cwd, model, thinking, prompt, signal}), signal);
    return {success: true, output: summary ?? '', error: null, exit_code: 0};
  } catch (error) {
    return agentFailure(error instanceof Error ? error.message : String(error));
  }
}

// pi has no built-in timeout and may not reject session.prompt() the instant we
// abort. Racing the harness call against the abort signal guarantees the step loop
// reaches its abort-before-report guard in seconds instead of hanging until lease
// expiry; the harness still calls session.abort() to stop the agent's own work.
function raceAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    // `work` (the harness call) is already in flight; attach a no-op catch so its
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

// All agent-step failures are `agent_invocation_failed` in v1 (the server derives
// the `user` category from the step type). An aborted step never reaches the API:
// the step loop returns before reporting once the signal fires.
function agentFailure(message: string): StepResult {
  const error: StepErrorDtoShape = {message, reason: 'agent_invocation_failed'};
  return {success: false, output: '', error, exit_code: null};
}
