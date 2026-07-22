import {
  DEFAULT_HARNESS_TOOL_DEPLOYMENT_CONFIG,
  getModelProviderEntry,
  listEnabledHarnessTools,
  listHarnessDescriptors,
  MODEL_PROVIDER_IDS,
} from '@shipfox/api-agent-dto';
import type {AgentValidationCatalog} from '@shipfox/api-agent-dto/inter-module';

export const agentValidationCatalog: AgentValidationCatalog = {
  version: 1,
  providers: MODEL_PROVIDER_IDS.map((id) => ({
    id,
    support_status: getModelProviderEntry(id)?.support_status ?? 'unsupported',
  })),
  harnesses: listHarnessDescriptors().map((harness) => ({
    id: harness.id,
    supported_provider_ids: [...harness.supportedProviderIds],
    thinking_levels: [...harness.thinkingLevels],
    effective_tools: listEnabledHarnessTools(
      harness.id,
      DEFAULT_HARNESS_TOOL_DEPLOYMENT_CONFIG,
    ).map((tool) => tool.name),
  })),
};
