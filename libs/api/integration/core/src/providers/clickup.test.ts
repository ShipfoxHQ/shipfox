import {clickupNamespaceSuffix} from './clickup.js';

describe('ClickUp secret namespace', () => {
  it('accepts only the ClickUp namespace prefix', () => {
    expect(clickupNamespaceSuffix('system/integrations/clickup/connection-id')).toBe(
      'connection-id',
    );
    expect(() => clickupNamespaceSuffix('system/integrations/jira/connection-id')).toThrow(
      'unscoped secret namespace',
    );
  });
});
