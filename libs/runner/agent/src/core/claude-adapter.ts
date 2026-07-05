import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {
  type EffortLevel,
  type Query,
  query,
  type SDKResultMessage,
} from '@anthropic-ai/claude-agent-sdk';
import {assertRunnerEgressAllowed} from '#core/egress.js';
import {AgentConfigError} from '#core/errors.js';
import type {HarnessAdapter, HarnessInvocation, HarnessResult} from '#core/harness.js';

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
  const controller = new AbortController();
  const abortQuery = () => {
    controller.abort();
    claudeQuery?.close();
  };

  try {
    configDir = await createClaudeConfigDir(cwd);
    if (signal.aborted) throw new Error('Agent step aborted before the Claude session started');

    claudeQuery = query({
      prompt,
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
        persistSession: false,
        includePartialMessages: false,
      },
    });
    signal.addEventListener('abort', abortQuery, {once: true});
    if (signal.aborted) {
      abortQuery();
      throw new Error('Agent step aborted before the Claude session started');
    }

    for await (const message of claudeQuery) {
      forwardSessionEntry(onSessionEntry, message);
      if (message.type !== 'result') continue;
      return claudeResult(message);
    }
  } finally {
    signal.removeEventListener('abort', abortQuery);
    claudeQuery?.close();
    if (configDir !== undefined) await rm(configDir, {recursive: true, force: true});
  }

  throw new Error('Claude agent did not emit a result message.');
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
  return {summary: message.result};
}

function claudeErrorMessage(message: SDKResultMessage): string {
  if ('result' in message && message.result !== '') return message.result;
  if ('errors' in message && message.errors.length > 0) return message.errors.join('\n');
  return `Claude agent returned ${message.subtype}.`;
}
