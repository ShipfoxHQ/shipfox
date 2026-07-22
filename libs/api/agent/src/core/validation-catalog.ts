import {
  getModelProviderEntry,
  listEnabledHarnessTools,
  listHarnessDescriptors,
  MODEL_PROVIDER_IDS,
} from '@shipfox/api-agent-dto';
import type {AgentValidationCatalog} from '@shipfox/api-agent-dto/inter-module';
import {harnessToolDeploymentConfig} from '#config.js';

/** Produces the versioned, JSON-safe policy snapshot consumed by Definitions. */
export function getAgentValidationCatalog(): AgentValidationCatalog {
  return {
    version: 1,
    providers: MODEL_PROVIDER_IDS.map((id) => ({
      id,
      support_status: getModelProviderEntry(id)?.support_status ?? 'unsupported',
    })),
    harnesses: listHarnessDescriptors().map((harness) => ({
      id: harness.id,
      supported_provider_ids: [...harness.supportedProviderIds],
      thinking_levels: [...harness.thinkingLevels],
      effective_tools: listEnabledHarnessTools(harness.id, harnessToolDeploymentConfig).map(
        (tool) => tool.name,
      ),
    })),
  };
}
