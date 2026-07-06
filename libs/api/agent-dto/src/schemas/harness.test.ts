import {
  getHarnessToolDescriptor,
  harnessSupportsTool,
  listEnabledHarnessTools,
  listHarnessTools,
} from './harness.js';

const PI_BUILT_IN_TOOLS = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'];
const PI_WEB_ACCESS_TOOLS = ['web_search', 'fetch_content', 'get_search_content'];
const CLAUDE_TOOLS = ['Read', 'Bash', 'Edit', 'Write', 'Glob', 'Grep', 'WebFetch', 'WebSearch'];

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

  it('matches harness tool names case-sensitively', () => {
    const piDeploymentConfig = {pi: {enabledToolPackages: ['pi-web-access']}} as const;

    expect(getHarnessToolDescriptor('pi', 'WebSearch')).toBeUndefined();
    expect(harnessSupportsTool('pi', 'WebSearch', piDeploymentConfig)).toBe(false);
    expect(getHarnessToolDescriptor('claude', 'web_search')).toBeUndefined();
    expect(harnessSupportsTool('claude', 'web_search')).toBe(false);
    expect(harnessSupportsTool('claude', 'WebSearch')).toBe(true);
  });
});
