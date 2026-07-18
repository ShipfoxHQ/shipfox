import {createSlackIntegrationProvider} from '#index.js';

describe('createSlackIntegrationProvider', () => {
  it('does not mount webhook routes without route options', () => {
    const provider = createSlackIntegrationProvider();

    expect(provider.routes).toEqual([]);
  });

  it('rejects incomplete webhook route options', () => {
    expect(() => createSlackIntegrationProvider({routes: {}})).toThrow(
      'Slack webhook routes require every core persistence dependency',
    );
  });
});
