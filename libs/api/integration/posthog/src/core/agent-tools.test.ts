import {posthogAgentToolCatalog, posthogAgentToolSelectionCatalog} from './agent-tools.js';

describe('PostHog agent tool catalog', () => {
  it('keeps the allow-list and selection catalog deliberate', () => {
    expect(posthogAgentToolCatalog).toMatchSnapshot();
    expect(posthogAgentToolSelectionCatalog).toMatchSnapshot();
  });
});
