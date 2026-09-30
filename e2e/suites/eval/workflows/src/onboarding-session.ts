import {
  query as claudeQuery,
  type Options,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type {SimulatedUser, SimulatorUsage} from './simulated-user.js';

// Pinned so a result names the agent it measured; the default of the CLI moves with releases.
export const DEFAULT_AGENT_MODEL = 'claude-sonnet-5-5';
const PARAGRAPH_SEPARATOR = /\n\s*\n/u;
const TRAILING_FORMATTING = /[\s*_"'`)\]]+$/u;

export type SessionStopReason = 'completed' | 'max_turns' | 'timeout' | 'budget' | 'error';

export interface SessionQuestion {
  question: string;
  answer: string;
}

export interface AgentUsage {
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export interface OnboardingSessionResult {
  stop_reason: SessionStopReason;
  error?: string;
  /** Model calls of the main agent, the count `max_turns` limits. */
  turns: number;
  questions: SessionQuestion[];
  /** The agent's last message, which the graders read. */
  final_message: string;
  /** The SDK message stream with the simulated user's turns in it, one JSON object per line. */
  transcript_jsonl: string;
  session_id?: string;
  duration_ms: number;
  usage: {agent: AgentUsage; simulator: SimulatorUsage};
}

/** What the driver needs of the SDK's `query`, so tests can replay a recorded conversation. */
export type ClaudeQuery = (params: {
  prompt: AsyncIterable<SDKUserMessage>;
  options: Options;
}) => AsyncIterable<SDKMessage>;

export interface OnboardingSessionOptions {
  prompt: string;
  /** The temporary repository the agent works in. */
  cwd: string;
  /** The recording proxy's MCP endpoint. */
  mcpUrl: string;
  simulatedUser: SimulatedUser;
  maxTurns: number;
  timeoutSeconds: number;
  /** The environment the agent's process sees. See `agentEnvironment`. */
  env: Record<string, string>;
  model?: string;
  query?: ClaudeQuery;
  now?: () => number;
}

export interface AgentEnvironmentOptions {
  apiKey: string;
  /** Holds Claude Code's state, so nothing of the developer's own configuration is read. */
  home: string;
  path: string;
}

/** The variables the agent gets: no Langfuse, GitHub, or Shipfox credentials, and no developer state. */
export function agentEnvironment(options: AgentEnvironmentOptions): Record<string, string> {
  return {
    ANTHROPIC_API_KEY: options.apiKey,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    CLAUDE_CONFIG_DIR: `${options.home}/.claude`,
    HOME: options.home,
    PATH: options.path,
  };
}

/** Whether the agent's last paragraph asks the user something. */
export function endsWithQuestion(message: string): boolean {
  const paragraphs = message.trim().split(PARAGRAPH_SEPARATOR);
  const last = paragraphs.at(-1) ?? '';
  return last
    .split('\n')
    .some((line) => line.trim().replace(TRAILING_FORMATTING, '').endsWith('?'));
}

class UserMessageQueue implements AsyncIterable<SDKUserMessage> {
  readonly #messages: SDKUserMessage[] = [];
  readonly #waiters: Array<(value: IteratorResult<SDKUserMessage>) => void> = [];
  #closed = false;

  push(content: string): void {
    const message: SDKUserMessage = {
      type: 'user',
      message: {role: 'user', content},
      parent_tool_use_id: null,
    };
    const waiter = this.#waiters.shift();
    if (waiter) waiter({done: false, value: message});
    else this.#messages.push(message);
  }

  close(): void {
    this.#closed = true;
    for (const waiter of this.#waiters.splice(0)) waiter({done: true, value: undefined});
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const message = this.#messages.shift();
        if (message !== undefined) return Promise.resolve({done: false, value: message});
        if (this.#closed) return Promise.resolve({done: true, value: undefined});
        return new Promise((resolve) => this.#waiters.push(resolve));
      },
    };
  }
}

function assistantText(message: SDKMessage): string {
  if (message.type !== 'assistant') return '';
  const {content} = message.message;
  if (typeof content === 'string') return content;
  return content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n');
}

function emptyAgentUsage(): AgentUsage {
  return {
    cost_usd: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };
}

/** The result message carries the running totals, so the latest one is the whole session's. */
function agentUsageFrom(message: Extract<SDKMessage, {type: 'result'}>): AgentUsage {
  const usage = emptyAgentUsage();
  usage.cost_usd = message.total_cost_usd;
  for (const model of Object.values(message.modelUsage)) {
    usage.input_tokens += model.inputTokens;
    usage.output_tokens += model.outputTokens;
    usage.cache_read_input_tokens += model.cacheReadInputTokens;
    usage.cache_creation_input_tokens += model.cacheCreationInputTokens;
  }
  return usage;
}

const RESULT_STOP_REASONS: Record<string, SessionStopReason> = {
  error_max_turns: 'max_turns',
  error_max_budget_usd: 'budget',
};

// Retrying these can't help, and the SDK retries until the session timeout: a wrong key would
// otherwise hold every repeat for the full 20 minutes.
const FATAL_API_ERRORS = new Set([
  'authentication_failed',
  'oauth_org_not_allowed',
  'account_on_hold',
  'billing_error',
  'invalid_request',
  'model_not_found',
]);

type ResultMessage = Extract<SDKMessage, {type: 'result'}>;

/** The state of one session, so each step of the loop stays a small method. */
class Session {
  readonly #options: OnboardingSessionOptions;
  readonly #now: () => number;
  readonly #transcript: string[] = [];
  readonly #input = new UserMessageQueue();
  readonly controller = new AbortController();
  readonly questions: SessionQuestion[] = [];
  readonly simulator: SimulatorUsage = {input_tokens: 0, output_tokens: 0};
  stopReason: SessionStopReason = 'completed';
  error: string | undefined;
  stopped = false;
  turns = 0;
  finalMessage = '';
  sessionId: string | undefined;
  agent = emptyAgentUsage();
  #lastText = '';

  constructor(options: OnboardingSessionOptions, now: () => number) {
    this.#options = options;
    this.#now = now;
  }

  get transcript(): string {
    return `${this.#transcript.join('\n')}\n`;
  }

  get lastMessage(): string {
    return this.finalMessage || this.#lastText;
  }

  record(entry: object): void {
    this.#transcript.push(
      JSON.stringify({...entry, timestamp: new Date(this.#now()).toISOString()}),
    );
  }

  say(content: string): void {
    this.record({type: 'user', message: {role: 'user', content}, parent_tool_use_id: null});
    this.#input.push(content);
  }

  stop(reason: SessionStopReason, message?: string): void {
    if (this.stopped) return;
    this.stopped = true;
    this.stopReason = reason;
    if (message !== undefined) this.error = message;
    this.#input.close();
    this.controller.abort();
  }

  get input(): AsyncIterable<SDKUserMessage> {
    return this.#input;
  }

  finish(): void {
    this.#input.close();
    if (!this.controller.signal.aborted) this.controller.abort();
  }

  result(durationMs: number): OnboardingSessionResult {
    return {
      stop_reason: this.stopReason,
      ...(this.error === undefined ? {} : {error: this.error}),
      turns: this.turns,
      questions: this.questions,
      final_message: this.lastMessage,
      transcript_jsonl: this.transcript,
      ...(this.sessionId === undefined ? {} : {session_id: this.sessionId}),
      duration_ms: durationMs,
      usage: {agent: this.agent, simulator: this.simulator},
    };
  }

  /** Reads one SDK message. It stops the session or, at a question, lets the user answer. */
  async handle(message: SDKMessage): Promise<void> {
    if (message.type === 'system' && message.subtype === 'init')
      this.sessionId = message.session_id;
    this.record(message);
    if (message.type === 'assistant' && message.parent_tool_use_id === null)
      this.#countTurn(message);
    if (message.type === 'system' && message.subtype === 'api_retry') this.#checkRetry(message);
    if (message.type === 'result') await this.#handleResult(message);
  }

  #checkRetry(message: Extract<SDKMessage, {subtype: 'api_retry'}>): void {
    if (FATAL_API_ERRORS.has(message.error)) {
      this.stop('error', `The Anthropic API rejected the agent: ${message.error}.`);
    }
  }

  #countTurn(message: SDKMessage): void {
    this.turns += 1;
    this.#lastText = assistantText(message) || this.#lastText;
    if (this.turns > this.#options.maxTurns) {
      this.stop('max_turns', `The agent used more than ${this.#options.maxTurns} turns.`);
    }
  }

  async #handleResult(message: ResultMessage): Promise<void> {
    this.agent = agentUsageFrom(message);
    if (message.subtype !== 'success') {
      this.stop(
        RESULT_STOP_REASONS[message.subtype] ?? 'error',
        `The session ended with ${message.subtype}.`,
      );
      return;
    }
    this.finalMessage = message.result || this.#lastText;
    if (!endsWithQuestion(this.finalMessage)) {
      this.stop('completed');
      return;
    }
    // Answering would start another model call, which the limit doesn't allow.
    if (this.turns >= this.#options.maxTurns) {
      this.stop('max_turns', `The agent used its ${this.#options.maxTurns} turns and asked again.`);
      return;
    }
    // The timeout aborts the answer too, so a slow simulator can't hold the session past it.
    const answer = await this.#options.simulatedUser.answer(this.finalMessage, {
      signal: this.controller.signal,
    });
    this.simulator.input_tokens += answer.usage.input_tokens;
    this.simulator.output_tokens += answer.usage.output_tokens;
    this.questions.push({question: this.finalMessage, answer: answer.text});
    this.say(answer.text);
  }
}

function claudeOptions(options: OnboardingSessionOptions, session: Session): Options {
  return {
    model: options.model ?? DEFAULT_AGENT_MODEL,
    cwd: options.cwd,
    // The CI virtual machine is thrown away after the job, as the runner's own harness assumes.
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    // Neither the developer's settings nor their MCP servers may reach the agent.
    settingSources: [],
    strictMcpConfig: true,
    mcpServers: {shipfox: {type: 'http', url: options.mcpUrl}},
    // The simulated user answers plain messages, so the agent has to ask in plain text.
    disallowedTools: ['AskUserQuestion'],
    abortController: session.controller,
    env: options.env,
  };
}

/**
 * Runs one Claude Agent SDK session against the recording MCP proxy. When the agent ends its
 * turn with a question, the simulated user answers and the session continues. It stops when the
 * agent ends without a question, at `max_turns` model calls, or at the timeout, and it never
 * throws: a session that can't finish reports why in `stop_reason` and `error`.
 */
export async function runOnboardingSession(
  options: OnboardingSessionOptions,
): Promise<OnboardingSessionResult> {
  const now = options.now ?? Date.now;
  const query = options.query ?? claudeQuery;
  const startedAt = now();
  const session = new Session(options, now);
  const timer = setTimeout(
    () => session.stop('timeout', `The session timeout of ${options.timeoutSeconds}s ran out.`),
    options.timeoutSeconds * 1_000,
  );

  try {
    session.say(options.prompt);
    const messages = query({prompt: session.input, options: claudeOptions(options, session)});
    for await (const message of messages) {
      if (session.stopped) break;
      await session.handle(message);
      if (session.stopped) break;
    }
  } catch (caught) {
    // An abort is how a timeout or a turn limit ends the stream, and stop() already said why.
    if (!session.stopped) {
      session.stopReason = 'error';
      session.error = caught instanceof Error ? caught.message : String(caught);
    }
  } finally {
    clearTimeout(timer);
    session.finish();
  }

  return session.result(now() - startedAt);
}
