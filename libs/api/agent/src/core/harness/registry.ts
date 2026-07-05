import type {AgentModelOptionDto, Harness, SupportedModelProviderId} from '@shipfox/api-agent-dto';
import {SUPPORTED_MODEL_PROVIDER_IDS} from '@shipfox/api-agent-dto';
import {UnsupportedHarnessProviderError} from '../errors.js';
import {runProviderProbe} from '../model-provider-validation.js';
import {CLAUDE_HARNESS, claudeHarnessCatalog} from './claude.js';
import {PI_HARNESS, piHarnessCatalog} from './pi.js';

export interface HarnessDescriptor {
  id: Harness;
  label: string;
  supportedProviderIds: readonly string[];
  thinkingLevels: readonly string[];
  defaultThinking: string;
}

export interface HarnessProviderCatalog {
  listModels(providerId: string): AgentModelOptionDto[];
  validateCredentials(params: {
    providerId: string;
    model: string;
    credentials: Record<string, string>;
    signal?: AbortSignal | undefined;
  }): Promise<void>;
}

export interface ProbeHarnessProviderCredentialsParams {
  harness: Harness;
  providerId: string;
  model: string;
  credentials: Record<string, string>;
  signal?: AbortSignal | undefined;
}

const REGISTRY: Record<Harness, {descriptor: HarnessDescriptor; catalog: HarnessProviderCatalog}> =
  {
    pi: {descriptor: PI_HARNESS, catalog: piHarnessCatalog},
    claude: {descriptor: CLAUDE_HARNESS, catalog: claudeHarnessCatalog},
  };

const supportedModelProviderIds = new Set<string>(SUPPORTED_MODEL_PROVIDER_IDS);

export function getHarnessDescriptor(id: Harness): HarnessDescriptor {
  return REGISTRY[id].descriptor;
}

export function listHarnessDescriptors(): HarnessDescriptor[] {
  return Object.values(REGISTRY).map((entry) => entry.descriptor);
}

export function harnessSupportsProvider(id: Harness, providerId: string): boolean {
  return REGISTRY[id].descriptor.supportedProviderIds.includes(providerId);
}

export function listHarnessProviderModels(
  harness: Harness,
  providerId: string,
): AgentModelOptionDto[] {
  const entry = REGISTRY[harness];
  assertHarnessSupportsProvider(entry.descriptor, providerId);
  return entry.catalog.listModels(providerId);
}

export async function probeHarnessProviderCredentials(
  params: ProbeHarnessProviderCredentialsParams,
): Promise<void> {
  const entry = REGISTRY[params.harness];
  assertHarnessSupportsProvider(entry.descriptor, params.providerId);

  await runProviderProbe({
    probe: entry.catalog.validateCredentials,
    args: {
      providerId: params.providerId,
      model: params.model,
      credentials: params.credentials,
      ...(params.signal ? {signal: params.signal} : {}),
    },
    metricLabel: metricLabel(params.providerId),
    providerId: params.providerId,
    secrets: Object.values(params.credentials),
    ...(params.signal ? {signal: params.signal} : {}),
  });
}

function assertHarnessSupportsProvider(descriptor: HarnessDescriptor, providerId: string): void {
  if (descriptor.supportedProviderIds.includes(providerId)) return;

  throw new UnsupportedHarnessProviderError(
    descriptor.id,
    providerId,
    descriptor.supportedProviderIds,
  );
}

function metricLabel(providerId: string): SupportedModelProviderId | 'custom' {
  return supportedModelProviderIds.has(providerId)
    ? (providerId as SupportedModelProviderId)
    : 'custom';
}
