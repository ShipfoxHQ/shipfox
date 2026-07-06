import {type AgentThinking, agentThinkingByHarness, type Harness} from '@shipfox/workflow-document';
import {type ModelProviderRef, SUPPORTED_MODEL_PROVIDER_IDS} from './model-provider-id.js';

export const HARNESS_TOOL_PACKAGE_NAMES = ['pi-web-access'] as const;

export type HarnessToolPackageName = (typeof HARNESS_TOOL_PACKAGE_NAMES)[number];

export interface HarnessToolDescriptor {
  readonly name: string;
  readonly label: string;
  readonly source: 'built_in' | 'package';
  readonly packageName?: HarnessToolPackageName;
  readonly enabledByDefault: boolean;
}

export interface HarnessToolDeploymentConfig {
  readonly pi?: {
    readonly enabledToolPackages?: readonly HarnessToolPackageName[];
    readonly webSearchEnabled?: boolean;
  };
  readonly claude?: {
    readonly enabledToolPackages?: readonly HarnessToolPackageName[];
  };
}

export interface HarnessDescriptor {
  readonly id: Harness;
  readonly label: string;
  readonly description: string;
  readonly supportedProviderIds: readonly string[];
  readonly thinkingLevels: readonly AgentThinking[];
  readonly defaultThinking: AgentThinking;
  readonly defaultProviderId: ModelProviderRef;
  readonly tools: readonly HarnessToolDescriptor[];
}

export const PI_HARNESS: HarnessDescriptor = {
  id: 'pi',
  label: 'pi',
  description: 'Works with 30+ model providers',
  supportedProviderIds: SUPPORTED_MODEL_PROVIDER_IDS,
  thinkingLevels: agentThinkingByHarness.pi.options,
  defaultThinking: 'xhigh',
  defaultProviderId: 'anthropic',
  tools: [
    builtInTool('read', 'Read'),
    builtInTool('bash', 'Bash'),
    builtInTool('edit', 'Edit'),
    builtInTool('write', 'Write'),
    builtInTool('grep', 'Grep'),
    builtInTool('find', 'Find'),
    builtInTool('ls', 'List'),
    packageTool('web_search', 'Web search', 'pi-web-access'),
    packageTool('fetch_content', 'Fetch content', 'pi-web-access'),
    packageTool('get_search_content', 'Get search content', 'pi-web-access'),
  ],
};

export const CLAUDE_HARNESS: HarnessDescriptor = {
  id: 'claude',
  label: 'Claude',
  description: 'Runs on your Anthropic API key',
  supportedProviderIds: ['anthropic'],
  thinkingLevels: agentThinkingByHarness.claude.options,
  defaultThinking: 'xhigh',
  defaultProviderId: 'anthropic',
  tools: [
    builtInTool('Read', 'Read'),
    builtInTool('Bash', 'Bash'),
    builtInTool('Edit', 'Edit'),
    builtInTool('Write', 'Write'),
    builtInTool('Glob', 'Glob'),
    builtInTool('Grep', 'Grep'),
    builtInTool('WebFetch', 'Web fetch'),
    builtInTool('WebSearch', 'Web search'),
  ],
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

export function listHarnessTools(id: Harness): HarnessToolDescriptor[] {
  return [...getHarnessDescriptor(id).tools];
}

export function getHarnessToolDescriptor(
  id: Harness,
  toolName: string,
): HarnessToolDescriptor | undefined {
  return getHarnessDescriptor(id).tools.find((tool) => tool.name === toolName);
}

export function listEnabledHarnessTools(
  id: Harness,
  deploymentConfig: HarnessToolDeploymentConfig = {},
): HarnessToolDescriptor[] {
  return getHarnessDescriptor(id).tools.filter((tool) =>
    isHarnessToolEnabled(id, tool, deploymentConfig),
  );
}

export function harnessSupportsTool(
  id: Harness,
  toolName: string,
  deploymentConfig: HarnessToolDeploymentConfig = {},
): boolean {
  const tool = getHarnessToolDescriptor(id, toolName);
  if (tool === undefined) return false;

  return isHarnessToolEnabled(id, tool, deploymentConfig);
}

function isHarnessToolEnabled(
  id: Harness,
  tool: HarnessToolDescriptor,
  deploymentConfig: HarnessToolDeploymentConfig,
): boolean {
  if (!tool.enabledByDefault) return false;
  if (tool.source === 'built_in') return true;

  const packageName = tool.packageName;
  if (packageName === undefined) return false;

  const harnessConfig = deploymentConfig[id];
  if (!harnessConfig?.enabledToolPackages?.includes(packageName)) return false;

  return !isDisabledPiSearchTool(id, tool, deploymentConfig);
}

function isDisabledPiSearchTool(
  id: Harness,
  tool: HarnessToolDescriptor,
  deploymentConfig: HarnessToolDeploymentConfig,
): boolean {
  return (
    id === 'pi' &&
    deploymentConfig.pi?.webSearchEnabled === false &&
    (tool.name === 'web_search' || tool.name === 'get_search_content')
  );
}

function builtInTool(name: string, label: string): HarnessToolDescriptor {
  return {name, label, source: 'built_in', enabledByDefault: true};
}

function packageTool(
  name: string,
  label: string,
  packageName: HarnessToolPackageName,
): HarnessToolDescriptor {
  return {name, label, source: 'package', packageName, enabledByDefault: true};
}
