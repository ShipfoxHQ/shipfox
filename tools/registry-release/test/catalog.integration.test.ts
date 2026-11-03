import {join} from 'node:path';
import {buildPackage} from '../src/build.js';
import {discoverPackages, loadConfig} from '../src/config.js';
import {TOOL_VERSION} from './helpers.js';

// Builds the real catalog, so each JavaScript action prunes this monorepo and installs its build tree.
const BUILD_TIMEOUT = 120_000;

describe('the first-party catalog', () => {
  it('builds every configured package with stable digests', {timeout: BUILD_TIMEOUT}, async () => {
    const root = join(import.meta.dirname, '../../..');
    const config = await loadConfig(join(root, 'tools/registry-release/registry.config.yaml'));
    const packages = await discoverPackages({root, config});

    const first = await Promise.all(
      packages.map((configured) => buildPackage({configured, toolVersion: TOOL_VERSION})),
    );
    const second = await Promise.all(
      packages.map((configured) => buildPackage({configured, toolVersion: TOOL_VERSION})),
    );

    expect(first.map(({package: name}) => name)).toContain('shipfox/ticket-to-pr');
    expect(first.map(({package: name}) => name)).toContain('shipfox/slack-thread-digest');
    expect(second.map(({fingerprint}) => fingerprint)).toEqual(
      first.map(({fingerprint}) => fingerprint),
    );
    for (const built of first) {
      expect(built.license, built.package).toBe('MIT');
    }
  });
});
