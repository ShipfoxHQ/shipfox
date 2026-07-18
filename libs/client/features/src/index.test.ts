import {describe, expect, it} from 'vitest';
import {defaultFeatures} from './index.js';

describe('defaultFeatures', () => {
  it('composes the upstream client features in manifest order', () => {
    expect(defaultFeatures().map((feature) => feature.id)).toEqual([
      'shipfox.auth',
      'shipfox.invitations',
      'shipfox.integrations',
      'shipfox.projects',
      'shipfox.workflows',
      'shipfox.agent',
      'shipfox.workspace-settings',
    ]);
  });
});
