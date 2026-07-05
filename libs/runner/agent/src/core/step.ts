import type {CustomModelProviderRuntimeConfigDto, Harness} from '@shipfox/api-agent-dto';
import type {
  AgentConfigIssueDto,
  StepDto,
  StepErrorDto,
  StepErrorReasonDto,
} from '@shipfox/api-workflows-dto';
import type {StepResult} from '@shipfox/runner-execution';
import {AgentConfigError} from '#core/errors.js';
import type {HarnessAdapter} from '#core/harness.js';
import {piHarnessAdapter} from '#core/pi-adapter.js';

// When ENG-807 adds the Claude adapter, import it lazily with dynamic import so the
// Claude SDK and bundled native binary never load on the pi/run path.
const HARNESS_ADAPTERS: Record<Harness, HarnessAdapter | null> = {
  pi: piHarnessAdapter,
  claude: null,
};

export function executeAgentStep(
  step: StepDto,
  options: {
    signal?: AbortSignal;
    cwd?: string;
    runtime: {
      harness: Harness;
      provider: string;
      model: string;
      thinking: string;
      credentials: Record<string, string>;
      custom_provider?: CustomModelProviderRuntimeConfigDto | undefined;
    };
    gitConfigGlobal?: string | undefined;
    onSessionEntry?: (line: string) => void;
  },
): Promise<StepResult> {
  if (step.type !== 'agent') {
    return Promise.resolve(agentFailure(`Unsupported step type: ${step.type}`));
  }

  const {prompt} = step.config;
  if (typeof prompt !== 'string' || prompt === '') {
    return Promise.resolve(
      agentFailure(
        'Agent step config is missing prompt',
        'agent_config_invalid',
        'step_config_invalid',
      ),
    );
  }

  return runSelectedHarness({
    cwd: options.cwd ?? process.cwd(),
    harness: options.runtime.harness,
    model: options.runtime.model,
    prompt,
    thinking: options.runtime.thinking,
    provider: options.runtime.provider,
    credentials: options.runtime.credentials,
    customProvider: options.runtime.custom_provider,
    signal: options.signal,
    gitConfigGlobal: options.gitConfigGlobal,
    onSessionEntry: options.onSessionEntry,
  });
}

async function runSelectedHarness(params: {
  cwd: string;
  harness: Harness;
  model: string;
  prompt: string;
  thinking: string;
  provider: string;
  credentials: Record<string, string>;
  customProvider: CustomModelProviderRuntimeConfigDto | undefined;
  signal: AbortSignal | undefined;
  gitConfigGlobal: string | undefined;
  onSessionEntry: ((line: string) => void) | undefined;
}): Promise<StepResult> {
  const {
    cwd,
    harness,
    model,
    prompt,
    thinking,
    provider,
    credentials,
    customProvider,
    gitConfigGlobal,
    onSessionEntry,
  } = params;
  const signal = params.signal ?? new AbortController().signal;

  try {
    const adapter = selectHarnessAdapter(harness);
    const {summary} = await raceAbort(
      adapter.run({
        cwd,
        model,
        provider,
        thinking,
        prompt,
        credentials,
        customProvider,
        signal,
        ...(gitConfigGlobal ? {gitConfigGlobal} : {}),
        ...(onSessionEntry ? {onSessionEntry} : {}),
      }),
      signal,
    );
    return {success: true, output: summary ?? '', error: null, exit_code: 0};
  } catch (error) {
    const reason: StepErrorReasonDto =
      error instanceof AgentConfigError ? 'agent_config_invalid' : 'agent_invocation_failed';
    return agentFailure(
      error instanceof Error ? error.message : String(error),
      reason,
      error instanceof AgentConfigError ? error.agentConfigIssue : undefined,
    );
  }
}

// executeAgentStep(step, {runtime.harness, ...})
//   -> validate step type + prompt
//   -> selectHarnessAdapter(runtime.harness)
//      -> pi: piHarnessAdapter.run(invocation)
//      -> claude: null -> AgentConfigError until ENG-807 ships
//      -> future harness: compile error until listed in this Record
//   -> raceAbort(adapter.run(...), signal)
function selectHarnessAdapter(harness: Harness): HarnessAdapter {
  const adapter = HARNESS_ADAPTERS[harness];
  if (adapter === null) {
    throw new AgentConfigError(
      `Harness "${harness}" is not supported by this runner build ` +
        '(available once the Claude adapter ships).',
    );
  }
  return adapter;
}

// pi has no built-in timeout and may not reject session.prompt() the instant we
// abort. Racing the adapter run call against the abort signal guarantees the step
// loop reaches its abort-before-report guard in seconds instead of hanging until
// lease expiry; the pi adapter still calls session.abort() to stop the agent's own work.
function raceAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    // `work` (the adapter run call) is already in flight; attach a no-op catch so its
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
  reason: StepErrorReasonDto = 'agent_invocation_failed',
  agentConfigIssue?: AgentConfigIssueDto,
): StepResult {
  const error: StepErrorDto = {
    message,
    reason,
    ...(agentConfigIssue === undefined ? {} : {agent_config_issue: agentConfigIssue}),
  };
  return {success: false, output: '', error, exit_code: null};
}
