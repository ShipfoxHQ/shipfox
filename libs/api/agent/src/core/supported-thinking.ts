import {
  type AgentThinking,
  type Harness,
  type ManagedModelThinkingLevelMap,
  thinkingLevelsForHarness,
} from '@shipfox/api-agent-dto';

export interface ModelThinkingCapabilities {
  readonly reasoning?: boolean | undefined;
  readonly thinkingLevelMap?: ManagedModelThinkingLevelMap | undefined;
  readonly thinking_level_map?: ManagedModelThinkingLevelMap | undefined;
}

export function supportedThinkingForModel(
  harness: Harness,
  capabilities: ModelThinkingCapabilities = {},
): AgentThinking[] {
  const harnessLevels = thinkingLevelsForHarness(harness);
  if (harness === 'claude') return [...harnessLevels];

  const modelLevels =
    capabilities.reasoning === true
      ? harnessLevels
      : harnessLevels.filter((level) => level === 'off');
  const thinkingLevelMap = capabilities.thinkingLevelMap ?? capabilities.thinking_level_map;

  return modelLevels.filter((level) =>
    level === 'default' ? capabilities.reasoning === true : thinkingLevelMap?.[level] !== null,
  );
}
