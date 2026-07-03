import type {
  CustomModelProviderHeaderDto,
  DiscoverCustomModelProviderModelsBodyDto,
  DiscoverCustomModelProviderModelsResponseDto,
  ModelProviderApi,
} from '@shipfox/api-agent-dto';
import {assertEgressAllowed} from '@shipfox/node-egress-guard';
import {config} from '#config.js';
import {appendCustomProviderPath, googleDiscoveryUrl} from './custom-provider-url.js';
import {egressPolicy} from './model-provider-validation.js';

const GOOGLE_MODEL_PREFIX_PATTERN = /^models\//;
const MAX_DISCOVERY_RESPONSE_BYTES = 512 * 1024;

interface DiscoveredModel {
  id: string;
  label: string;
}

export async function discoverCustomModelProviderModels(
  params: DiscoverCustomModelProviderModelsBodyDto,
): Promise<DiscoverCustomModelProviderModelsResponseDto> {
  await assertEgressAllowed(params.base_url, egressPolicy());

  try {
    const response = await fetch(discoveryUrl(params.base_url, params.api), {
      method: 'GET',
      headers: discoveryHeaders(params.api, params.api_key, params.headers ?? []),
      redirect: 'error',
      signal: AbortSignal.timeout(config.AGENT_PROVIDER_VALIDATION_TIMEOUT_MS),
    });
    if (!response.ok) return {models: []};

    const payload = await readBoundedJson(response);
    if (payload === undefined) return {models: []};
    return {models: parseModelList(payload)};
  } catch {
    return {models: []};
  }
}

function discoveryUrl(baseUrl: string, api: ModelProviderApi): string {
  if (api === 'google-generative-ai') return googleDiscoveryUrl(baseUrl);
  return appendCustomProviderPath(baseUrl, 'models').toString();
}

function discoveryHeaders(
  api: ModelProviderApi,
  apiKey: string | undefined,
  headers: CustomModelProviderHeaderDto[],
): Headers {
  const result = new Headers(headers.map((header) => [header.name, header.value]));
  if (!apiKey) return result;

  switch (api) {
    case 'anthropic-messages':
      result.set('x-api-key', apiKey);
      result.set('anthropic-version', '2023-06-01');
      break;
    case 'google-generative-ai':
      result.set('x-goog-api-key', apiKey);
      break;
    default:
      result.set('authorization', `Bearer ${apiKey}`);
      break;
  }

  return result;
}

async function readBoundedJson(response: Response): Promise<unknown | undefined> {
  if (!response.body) return undefined;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      if (value === undefined) continue;

      totalBytes += value.byteLength;
      if (totalBytes > MAX_DISCOVERY_RESPONSE_BYTES) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const buffer = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return JSON.parse(new TextDecoder().decode(buffer));
}

function parseModelList(payload: unknown): DiscoveredModel[] {
  const candidates = extractModelCandidates(payload);
  const models = candidates.map(parseModelCandidate).filter(isDiscoveredModel);
  const seen = new Set<string>();
  return models.filter((model) => {
    if (seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  });
}

function extractModelCandidates(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];

  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.data)) return record.data;
  if (Array.isArray(record.models)) return record.models;
  return [];
}

function parseModelCandidate(candidate: unknown): DiscoveredModel | undefined {
  if (!candidate || typeof candidate !== 'object') return undefined;
  const record = candidate as Record<string, unknown>;
  const rawId = firstString(record.id, record.name);
  if (!rawId) return undefined;

  const id = rawId.replace(GOOGLE_MODEL_PREFIX_PATTERN, '');
  const label =
    firstString(record.label, record.display_name, record.displayName, record.name) ?? id;
  return {id, label: label.replace(GOOGLE_MODEL_PREFIX_PATTERN, '')};
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.length > 0);
}

function isDiscoveredModel(model: DiscoveredModel | undefined): model is DiscoveredModel {
  return model !== undefined;
}
