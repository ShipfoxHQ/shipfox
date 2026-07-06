import type {
  AgentModelOptionDto,
  Harness,
  HarnessDescriptor,
  HarnessToolDeploymentConfig,
  HarnessToolDescriptor,
  HarnessToolPackageName,
  SupportedModelProviderId,
} from '@shipfox/api-agent-dto';
import {
  getHarnessDescriptor,
  getHarnessToolDescriptor,
  harnessSupportsProvider,
  harnessSupportsTool,
  listEnabledHarnessTools,
  listHarnessDescriptors,
  listHarnessTools,
  SUPPORTED_MODEL_PROVIDER_IDS,
} from '@shipfox/api-agent-dto';
import {UnsupportedHarnessProviderError} from '../errors.js';
import {runProviderProbe} from '../model-provider-validation.js';
import {claudeHarnessCatalog} from './claude.js';
import {piHarnessCatalog} from './pi.js';

export {
  getHarnessDescriptor,
  getHarnessToolDescriptor,
  type HarnessDescriptor,
  type HarnessToolDeploymentConfig,
  type HarnessToolDescriptor,
  type HarnessToolPackageName,
  harnessSupportsProvider,
  harnessSupportsTool,
  listEnabledHarnessTools,
  listHarnessDescriptors,
  listHarnessTools,
};

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

const CATALOGS: Record<Harness, HarnessProviderCatalog> = {
  pi: piHarnessCatalog,
  claude: claudeHarnessCatalog,
};

const supportedModelProviderIds = new Set<string>(SUPPORTED_MODEL_PROVIDER_IDS);

export function listHarnessProviderModels(
  harness: Harness,
  providerId: string,
): AgentModelOptionDto[] {
  const descriptor = getHarnessDescriptor(harness);
  assertHarnessSupportsProvider(descriptor, providerId);
  return CATALOGS[harness].listModels(providerId);
}

export async function probeHarnessProviderCredentials(
  params: ProbeHarnessProviderCredentialsParams,
): Promise<void> {
  const descriptor = getHarnessDescriptor(params.harness);
  assertHarnessSupportsProvider(descriptor, params.providerId);

  await runProviderProbe({
    probe: CATALOGS[params.harness].validateCredentials,
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
