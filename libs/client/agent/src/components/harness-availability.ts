import {
  DEFAULT_HARNESS,
  type Harness,
  type HarnessDescriptor,
  listHarnessDescriptors,
  type ModelProviderConfigResponseDto,
} from '@shipfox/api-agent-dto';

export function configSupportsHarness(
  config: ModelProviderConfigResponseDto,
  descriptor: HarnessDescriptor,
): boolean {
  if (config.kind === 'custom') return descriptor.id === DEFAULT_HARNESS;
  return descriptor.supportedProviderIds.includes(config.provider_id);
}

export function isHarnessAvailable(
  descriptor: HarnessDescriptor,
  configs: ModelProviderConfigResponseDto[],
): boolean {
  return configs.some((config) => configSupportsHarness(config, descriptor));
}

export function compatibleHarnessIds({
  isCustom,
  providerId,
}: {
  isCustom: boolean;
  providerId: string;
}): Harness[] {
  if (isCustom) return [DEFAULT_HARNESS];
  return listHarnessDescriptors()
    .filter((descriptor) => descriptor.supportedProviderIds.includes(providerId))
    .map((descriptor) => descriptor.id);
}
