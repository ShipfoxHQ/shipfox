import type {AgentModelOptionDto} from '@shipfox/api-agent-dto';
import {config} from '#config.js';
import type {HarnessDescriptor, HarnessProviderCatalog} from './registry.js';

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const PROBE_MAX_TOKENS = 64;
const PROBE_PROMPT = 'Reply with OK.';

export const CLAUDE_MODEL_LINE: AgentModelOptionDto[] = [
  {id: 'claude-3-5-haiku-20241022', label: 'Claude Haiku 3.5'},
  {id: 'claude-3-5-haiku-latest', label: 'Claude Haiku 3.5 (latest)'},
  {id: 'claude-3-5-sonnet-20240620', label: 'Claude Sonnet 3.5'},
  {id: 'claude-3-5-sonnet-20241022', label: 'Claude Sonnet 3.5 v2'},
  {id: 'claude-3-7-sonnet-20250219', label: 'Claude Sonnet 3.7'},
  {id: 'claude-3-haiku-20240307', label: 'Claude Haiku 3'},
  {id: 'claude-3-opus-20240229', label: 'Claude Opus 3'},
  {id: 'claude-3-sonnet-20240229', label: 'Claude Sonnet 3'},
  {id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (latest)'},
  {id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5'},
  {id: 'claude-opus-4-0', label: 'Claude Opus 4 (latest)'},
  {id: 'claude-opus-4-1', label: 'Claude Opus 4.1 (latest)'},
  {id: 'claude-opus-4-1-20250805', label: 'Claude Opus 4.1'},
  {id: 'claude-opus-4-20250514', label: 'Claude Opus 4'},
  {id: 'claude-opus-4-5', label: 'Claude Opus 4.5 (latest)'},
  {id: 'claude-opus-4-5-20251101', label: 'Claude Opus 4.5'},
  {id: 'claude-opus-4-6', label: 'Claude Opus 4.6'},
  {id: 'claude-opus-4-7', label: 'Claude Opus 4.7'},
  {id: 'claude-opus-4-8', label: 'Claude Opus 4.8'},
  {id: 'claude-sonnet-4-0', label: 'Claude Sonnet 4 (latest)'},
  {id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4'},
  {id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5 (latest)'},
  {id: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5'},
  {id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6'},
];

export const CLAUDE_HARNESS: HarnessDescriptor = {
  id: 'claude',
  label: 'Claude',
  supportedProviderIds: ['anthropic'],
  thinkingLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
  defaultThinking: 'xhigh',
};

export const claudeHarnessCatalog: HarnessProviderCatalog = {
  listModels: () => CLAUDE_MODEL_LINE,
  validateCredentials: probeClaudeCredentials,
};

async function probeClaudeCredentials(params: {
  model: string;
  credentials: Record<string, string>;
  signal?: AbortSignal | undefined;
}): Promise<void> {
  const apiKey = params.credentials.api_key;
  if (apiKey === undefined) throw new Error('Missing Anthropic API key credential.');

  const response = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: 'POST',
    headers: claudeProbeHeaders(apiKey),
    body: JSON.stringify(claudeProbeBody(params.model)),
    redirect: 'error',
    signal: timeoutSignal(params.signal, config.AGENT_PROVIDER_VALIDATION_TIMEOUT_MS),
  });

  try {
    if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}.`);
  } finally {
    await response.body?.cancel();
  }
}

function claudeProbeHeaders(apiKey: string): Headers {
  const headers = new Headers();
  headers.set('content-type', 'application/json');
  headers.set('x-api-key', apiKey);
  headers.set('anthropic-version', ANTHROPIC_VERSION);
  return headers;
}

function claudeProbeBody(model: string): unknown {
  return {
    model,
    max_tokens: PROBE_MAX_TOKENS,
    messages: [{role: 'user', content: PROBE_PROMPT}],
  };
}

function timeoutSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  return signal === undefined
    ? AbortSignal.timeout(timeoutMs)
    : AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
}
