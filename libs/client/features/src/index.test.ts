import {describe, expect, it} from '@shipfox/vitest/vi';
import manifest from '../package.json' with {type: 'json'};
import {defaultFeatures} from './index.js';

const SHIPFOX_PACKAGE_PATTERN = /^(@shipfox\/[^/]+)\//u;

describe('defaultFeatures', () => {
  it('composes the upstream client features in manifest order', () => {
    expect(defaultFeatures().map((feature) => feature.id)).toEqual([
      'shipfox.auth',
      'shipfox.invitations',
      'shipfox.integrations',
      'shipfox.projects',
      'shipfox.workflows',
      'shipfox.agent',
      'shipfox.runners',
      'shipfox.secrets',
      'shipfox.triggers',
      'shipfox.workspace-settings',
    ]);
  });

  it('declares every default route implementation package as a peer dependency', () => {
    const peerPackageNames = Object.keys(manifest.peerDependencies ?? {}).filter((name) =>
      name.startsWith('@shipfox/client-'),
    );

    const routePackageNames = new Set(
      defaultFeatures()
        .flatMap((feature) => feature.routes ?? [])
        .map(({impl}) => SHIPFOX_PACKAGE_PATTERN.exec(impl)?.[1])
        .filter((name): name is string => name !== undefined),
    );

    expect([...routePackageNames].sort()).toEqual(peerPackageNames.sort());
  });
});
