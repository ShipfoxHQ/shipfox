import {compatibleHarnessIds, configSupportsHarness} from '#core/harness-policy.js';
import type {HarnessDescriptor, ProviderConfig} from '#core/models.js';

export function isHarnessAvailable(
  descriptor: HarnessDescriptor,
  configs: readonly ProviderConfig[],
): boolean {
  return configs.some((config) => configSupportsHarness(config, descriptor));
}

export {compatibleHarnessIds};
