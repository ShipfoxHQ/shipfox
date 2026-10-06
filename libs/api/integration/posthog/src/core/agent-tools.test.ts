import {posthogAgentToolCatalog, posthogAgentToolSelectionCatalog} from './agent-tools.js';

describe('PostHog agent tool catalog', () => {
  it('keeps the allow-list and selection catalog deliberate', () => {
    expect(posthogAgentToolCatalog).toMatchSnapshot();
    expect(posthogAgentToolSelectionCatalog).toMatchSnapshot();
  });
});

// A tool step compiles every input schema with strict Ajv and no format plugin, which rejects an
// unknown format such as `date-time` and fails every call to the tool.
describe('PostHog agent tool input schemas', () => {
  it('declare no format keyword', () => {
    const withFormat = posthogAgentToolCatalog
      .filter((entry) => JSON.stringify(entry.inputSchema).includes('"format"'))
      .map((entry) => entry.id);

    expect(withFormat).toEqual([]);
  });
});
