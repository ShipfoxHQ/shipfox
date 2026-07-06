import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {
  createSdkMcpServer,
  type EffortLevel,
  type Query,
  query,
  type SDKResultMessage,
  type SDKUserMessage,
  tool,
} from '@anthropic-ai/claude-agent-sdk';
import {z} from 'zod';
import {assertRunnerEgressAllowed} from '#core/egress.js';
import {AgentConfigError} from '#core/errors.js';
import type {HarnessAdapter, HarnessInvocation, HarnessResult} from '#core/harness.js';
import {OutputCollector, runOutputTurnLoop, withOutputGuidance} from '#core/output-collector.js';

const ANTHROPIC_API_URL = 'https://api.anthropic.com';

export const claudeHarnessAdapter: HarnessAdapter = {run: runClaudeAgent};

async function runClaudeAgent(invocation: HarnessInvocation): Promise<HarnessResult> {
  const {
    cwd,
    model,
    provider,
    thinking,
    prompt,
    credentials,
    customProvider,
    gitConfigGlobal,
    signal,
    onSessionEntry,
  } = invocation;
  const collector = new OutputCollector(invocation.outputs);

  if (signal.aborted) throw new Error('Agent step aborted before the Claude session started');
  if (provider !== 'anthropic') {
    throw new AgentConfigError(
      `Harness "claude" only supports provider "anthropic"; received "${provider}".`,
      'provider_unsupported',
    );
  }
  if (customProvider !== undefined) {
    throw new AgentConfigError(
      'Harness "claude" does not support custom model providers.',
      'provider_unsupported',
    );
  }

  const apiKey = credentials.api_key;
  if (apiKey === undefined || apiKey === '') {
    throw new AgentConfigError(
      'No credentials configured for provider "anthropic". ' +
        'Verify the provider is configured for this workspace.',
      'provider_not_configured',
    );
  }

  await assertRunnerEgressAllowed(ANTHROPIC_API_URL, 'Claude Anthropic API endpoint');

  let configDir: string | undefined;
  let claudeQuery: Query | undefined;
  let messages: ClaudeInputStream | undefined;
  const controller = new AbortController();
  const abortQuery = () => {
    controller.abort();
    claudeQuery?.close();
  };

  try {
    configDir = await createClaudeConfigDir(cwd);
    if (signal.aborted) throw new Error('Agent step aborted before the Claude session started');

    messages = new ClaudeInputStream();
    claudeQuery = query({
      prompt: messages,
      options: {
        model,
        cwd,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        settingSources: ['project'],
        thinking: {type: 'adaptive'},
        effort: thinking as EffortLevel,
        abortController: controller,
        env: claudeEnvironment(apiKey, configDir, gitConfigGlobal),
        mcpServers: {
          shipfox_outputs: createSdkMcpServer({
            name: 'shipfox_outputs',
            version: '1.0.0',
            instructions: collector.guidanceText(),
            tools: [setOutputTool(collector)],
            alwaysLoad: true,
          }),
        },
        persistSession: false,
        includePartialMessages: false,
      },
    });
    signal.addEventListener('abort', abortQuery, {once: true});
    if (signal.aborted) {
      abortQuery();
      throw new Error('Agent step aborted before the Claude session started');
    }

    let response: string | undefined;
    const queryIterator = claudeQuery[Symbol.asyncIterator]();
    await runOutputTurnLoop({
      signal,
      prompt: withOutputGuidance(prompt, collector.guidanceText()),
      missingRequired: () => collector.missingRequired(),
      runTurn: async (message) => {
        messages?.push(userMessage(message));
        response = (await readClaudeResult({queryIterator, onSessionEntry})).response;
      },
    });
    messages.close();
    const outputs = collector.snapshot();
    return {
      ...(response === undefined ? {} : {response}),
      ...(Object.keys(outputs).length === 0 ? {} : {outputs}),
    };
  } finally {
    messages?.close();
    signal.removeEventListener('abort', abortQuery);
    claudeQuery?.close();
    if (configDir !== undefined) await rm(configDir, {recursive: true, force: true});
  }

  throw new Error('Claude agent did not emit a result message.');
}

function setOutputTool(collector: OutputCollector) {
  return tool(
    'set_output',
    'Set one structured output value for this workflow step.',
    {key: z.string(), value: z.string()},
    async (args) => {
      await Promise.resolve();
      const result = collector.trySet(args.key, args.value);
      return {
        content: [
          {
            type: 'text',
            text: result.ok ? `Output "${args.key}" set.` : result.feedback,
          },
        ],
      };
    },
    {alwaysLoad: true},
  );
}

async function readClaudeResult(params: {
  queryIterator: AsyncIterator<unknown>;
  onSessionEntry: ((line: string) => void) | undefined;
}): Promise<HarnessResult> {
  while (true) {
    const next = await params.queryIterator.next();
    if (next.done === true) break;
    const message = next.value;
    forwardSessionEntry(params.onSessionEntry, message);
    if (!isResultMessage(message)) continue;
    return claudeResult(message);
  }

  throw new Error('Claude agent did not emit a result message.');
}

function isResultMessage(message: unknown): message is SDKResultMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === 'result'
  );
}

class ClaudeInputStream implements AsyncIterable<SDKUserMessage> {
  readonly #messages: SDKUserMessage[] = [];
  readonly #waiters: Array<(value: IteratorResult<SDKUserMessage>) => void> = [];
  #closed = false;

  push(message: SDKUserMessage): void {
    const waiter = this.#waiters.shift();
    if (waiter) {
      waiter({done: false, value: message});
      return;
    }
    this.#messages.push(message);
  }

  close(): void {
    this.#closed = true;
    for (const waiter of this.#waiters.splice(0)) {
      waiter({done: true, value: undefined});
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const message = this.#messages.shift();
        if (message !== undefined) return Promise.resolve({done: false, value: message});
        if (this.#closed) return Promise.resolve({done: true, value: undefined});
        return new Promise<IteratorResult<SDKUserMessage>>((resolve) =>
          this.#waiters.push(resolve),
        );
      },
    };
  }
}

function userMessage(content: string): SDKUserMessage {
  return {
    type: 'user',
    message: {role: 'user', content},
    parent_tool_use_id: null,
  };
}

async function createClaudeConfigDir(cwd: string): Promise<string> {
  const logsDir = join(cwd, 'logs');
  await mkdir(logsDir, {recursive: true});
  return mkdtemp(join(logsDir, 'claude-config-'));
}

function forwardSessionEntry(
  onSessionEntry: ((line: string) => void) | undefined,
  message: unknown,
): void {
  try {
    onSessionEntry?.(JSON.stringify(message));
  } catch {
    // Session capture is best-effort; a log sink failure must not fail the agent turn.
  }
}

function claudeEnvironment(
  apiKey: string,
  configDir: string,
  gitConfigGlobal: string | undefined,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ANTHROPIC_API_KEY: apiKey,
    CLAUDE_CONFIG_DIR: configDir,
    CLAUDE_AGENT_SDK_CLIENT_APP: '@shipfox/runner-agent',
    ...(gitConfigGlobal ? {GIT_CONFIG_GLOBAL: gitConfigGlobal} : {}),
  };
}

function claudeResult(message: SDKResultMessage): HarnessResult {
  if (message.is_error || message.subtype !== 'success') {
    throw new Error(claudeErrorMessage(message));
  }
  return {response: message.result};
}

function claudeErrorMessage(message: SDKResultMessage): string {
  if ('result' in message && message.result !== '') return message.result;
  if ('errors' in message && message.errors.length > 0) return message.errors.join('\n');
  return `Claude agent returned ${message.subtype}.`;
}
