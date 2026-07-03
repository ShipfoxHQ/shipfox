import type {
  CustomModelProviderHeaderDto,
  DiscoverCustomModelProviderModelsBodyDto,
  DiscoverCustomModelProviderModelsResponseDto,
  ModelProviderApi,
} from '@shipfox/api-agent-dto';
import {assertEgressAllowed} from './egress-guard.js';
import {egressPolicy} from './model-provider-validation.js';

const TRAILING_SLASHES_PATTERN = /\/+$/;
const GOOGLE_MODEL_PREFIX_PATTERN = /^models\//;

interface DiscoveredModel {
  id: string;
  label: string;
}

export async function discoverCustomModelProviderModels(
  params: DiscoverCustomModelProviderModelsBodyDto,
): Promise<DiscoverCustomModelProviderModelsResponseDto> {
  await assertEgressAllowed(params.base_url, egressPolicy());

  try {
    const response = await fetch(discoveryUrl(params.api, params.base_url, params.api_key), {
      method: 'GET',
      headers: discoveryHeaders(params.api, params.api_key, params.headers ?? []),
      redirect: 'error',
    });
    if (!response.ok) return {models: []};

    const payload = await response.json();
    return {models: parseModelList(payload)};
  } catch {
    return {models: []};
  }
}

function discoveryUrl(api: ModelProviderApi, baseUrl: string, apiKey: string | undefined): string {
  const url = appendPath(baseUrl, 'models');
  if (api !== 'google-generative-ai' || !apiKey) return url.toString();

  url.searchParams.set('key', apiKey);
  return url.toString();
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
      break;
    default:
      result.set('authorization', `Bearer ${apiKey}`);
      break;
  }

  return result;
}

function appendPath(baseUrl: string, segment: string): URL {
  const url = new URL(baseUrl);
  const path = url.pathname.replace(TRAILING_SLASHES_PATTERN, '');
  url.pathname = `${path}/${segment}`;
  return url;
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
