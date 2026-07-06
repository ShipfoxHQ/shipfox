import {
  buildHarnessToolDeploymentConfig,
  DEFAULT_HARNESS_TOOL_DEPLOYMENT_CONFIG,
  getHarnessToolDescriptor,
  harnessSupportsTool,
  listEnabledHarnessTools,
  listHarnessTools,
  parsePiEnabledToolPackages,
} from './harness.js';

const PI_BUILT_IN_TOOLS = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'];
const PI_WEB_ACCESS_TOOLS = ['web_search', 'fetch_content', 'get_search_content'];
const CLAUDE_TOOLS = ['Read', 'Bash', 'Edit', 'Write', 'Glob', 'Grep', 'WebFetch', 'WebSearch'];
const piToolPackagesEnvPattern = /AGENT_PI_ENABLED_TOOL_PACKAGES/;

describe('harness tool catalog', () => {
  it('lists exact pi tool names in catalog order', () => {
    const toolNames = listHarnessTools('pi').map((tool) => tool.name);

    expect(toolNames).toEqual([...PI_BUILT_IN_TOOLS, ...PI_WEB_ACCESS_TOOLS]);
  });

  it('lists exact Claude tool names in catalog order', () => {
    const toolNames = listHarnessTools('claude').map((tool) => tool.name);

    expect(toolNames).toEqual(CLAUDE_TOOLS);
  });

  it('marks pi web access tools as package-backed catalog entries', () => {
    const packageTools = PI_WEB_ACCESS_TOOLS.map((toolName) =>
      getHarnessToolDescriptor('pi', toolName),
    );

    expect(packageTools).toEqual(
      PI_WEB_ACCESS_TOOLS.map((toolName) =>
        expect.objectContaining({
          name: toolName,
          source: 'package',
          packageName: 'pi-web-access',
          enabledByDefault: true,
        }),
      ),
    );
  });

  it('leaves pi package-backed tools unavailable unless their package is enabled', () => {
    const enabledToolNames = listEnabledHarnessTools('pi').map((tool) => tool.name);

    expect(enabledToolNames).toEqual(PI_BUILT_IN_TOOLS);
    expect(harnessSupportsTool('pi', 'fetch_content')).toBe(false);
    expect(harnessSupportsTool('pi', 'web_search')).toBe(false);
    expect(harnessSupportsTool('pi', 'get_search_content')).toBe(false);
  });

  it('enables pi web access tools when pi-web-access is enabled', () => {
    const deploymentConfig = {pi: {enabledToolPackages: ['pi-web-access']}} as const;
    const enabledToolNames = listEnabledHarnessTools('pi', deploymentConfig).map(
      (tool) => tool.name,
    );

    expect(enabledToolNames).toEqual([...PI_BUILT_IN_TOOLS, ...PI_WEB_ACCESS_TOOLS]);
    expect(harnessSupportsTool('pi', 'fetch_content', deploymentConfig)).toBe(true);
    expect(harnessSupportsTool('pi', 'web_search', deploymentConfig)).toBe(true);
    expect(harnessSupportsTool('pi', 'get_search_content', deploymentConfig)).toBe(true);
  });

  it('builds deployment defaults with pi web access and search enabled', () => {
    expect(DEFAULT_HARNESS_TOOL_DEPLOYMENT_CONFIG).toEqual({
      pi: {enabledToolPackages: ['pi-web-access'], webSearchEnabled: true},
      claude: {enabledToolPackages: []},
    });

    const enabledToolNames = listEnabledHarnessTools(
      'pi',
      DEFAULT_HARNESS_TOOL_DEPLOYMENT_CONFIG,
    ).map((tool) => tool.name);
    expect(enabledToolNames).toEqual([...PI_BUILT_IN_TOOLS, ...PI_WEB_ACCESS_TOOLS]);
  });

  it('deduplicates comma-delimited Pi tool package names', () => {
    const packageNames = parsePiEnabledToolPackages(' pi-web-access,pi-web-access ');

    expect(packageNames).toEqual(['pi-web-access']);
  });

  it('allows an empty Pi tool package list', () => {
    const packageNames = parsePiEnabledToolPackages('');

    expect(packageNames).toEqual([]);
  });

  it('rejects unknown Pi tool package names with the env var name', () => {
    expect(() => parsePiEnabledToolPackages('pi-web-access,unknown')).toThrow(
      piToolPackagesEnvPattern,
    );
  });

  it('keeps pi fetch content enabled when web search is disabled', () => {
    const deploymentConfig = {
      pi: {enabledToolPackages: ['pi-web-access'], webSearchEnabled: false},
    } as const;
    const enabledToolNames = listEnabledHarnessTools('pi', deploymentConfig).map(
      (tool) => tool.name,
    );

    expect(enabledToolNames).toEqual([...PI_BUILT_IN_TOOLS, 'fetch_content']);
    expect(harnessSupportsTool('pi', 'fetch_content', deploymentConfig)).toBe(true);
    expect(harnessSupportsTool('pi', 'web_search', deploymentConfig)).toBe(false);
    expect(harnessSupportsTool('pi', 'get_search_content', deploymentConfig)).toBe(false);
  });

  it('builds deployment config from explicit Pi package and search settings', () => {
    const deploymentConfig = buildHarnessToolDeploymentConfig({
      piEnabledToolPackages: 'pi-web-access, pi-web-access',
      piWebSearchEnabled: false,
    });

    expect(deploymentConfig).toEqual({
      pi: {enabledToolPackages: ['pi-web-access'], webSearchEnabled: false},
      claude: {enabledToolPackages: []},
    });
  });

  it('matches harness tool names case-sensitively', () => {
    const piDeploymentConfig = {pi: {enabledToolPackages: ['pi-web-access']}} as const;

    expect(getHarnessToolDescriptor('pi', 'WebSearch')).toBeUndefined();
    expect(harnessSupportsTool('pi', 'WebSearch', piDeploymentConfig)).toBe(false);
    expect(getHarnessToolDescriptor('claude', 'web_search')).toBeUndefined();
    expect(harnessSupportsTool('claude', 'web_search')).toBe(false);
    expect(harnessSupportsTool('claude', 'WebSearch')).toBe(true);
  });
});
