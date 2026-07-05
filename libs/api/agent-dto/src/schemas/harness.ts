import {type AgentThinking, agentThinkingByHarness, type Harness} from '@shipfox/workflow-document';
import {type ModelProviderRef, SUPPORTED_MODEL_PROVIDER_IDS} from './model-provider-id.js';

export interface HarnessDescriptor {
  readonly id: Harness;
  readonly label: string;
  readonly supportedProviderIds: readonly string[];
  readonly thinkingLevels: readonly AgentThinking[];
  readonly defaultThinking: AgentThinking;
  readonly defaultProviderId: ModelProviderRef;
}

export const PI_HARNESS: HarnessDescriptor = {
  id: 'pi',
  label: 'pi',
  supportedProviderIds: SUPPORTED_MODEL_PROVIDER_IDS,
  thinkingLevels: agentThinkingByHarness.pi.options,
  defaultThinking: 'xhigh',
  defaultProviderId: 'anthropic',
};

export const CLAUDE_HARNESS: HarnessDescriptor = {
  id: 'claude',
  label: 'Claude',
  supportedProviderIds: ['anthropic'],
  thinkingLevels: agentThinkingByHarness.claude.options,
  defaultThinking: 'xhigh',
  defaultProviderId: 'anthropic',
};

const HARNESS_DESCRIPTORS = {
  pi: PI_HARNESS,
  claude: CLAUDE_HARNESS,
} as const satisfies Record<Harness, HarnessDescriptor>;

export function getHarnessDescriptor(id: Harness): HarnessDescriptor {
  return HARNESS_DESCRIPTORS[id];
}

export function listHarnessDescriptors(): HarnessDescriptor[] {
  return Object.values(HARNESS_DESCRIPTORS);
}

export function harnessSupportsProvider(id: Harness, providerId: string): boolean {
  return getHarnessDescriptor(id).supportedProviderIds.includes(providerId);
}
