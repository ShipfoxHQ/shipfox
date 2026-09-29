import {mkdirSync, mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {discoverPackages, loadConfig, type RegistryReleaseConfig} from '../src/config.js';

const config: RegistryReleaseConfig = {
  registry: 'https://api.registry.shipfox.io',
  namespace: 'shipfox',
  packages: [
    {kind: 'action', path: 'catalog/actions/*'},
    {kind: 'template', path: 'catalog/templates/*'},
  ],
};

describe('discoverPackages', () => {
  it('names each package after its directory and skips files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'discover-'));
    for (const path of [
      'catalog/templates/b-two',
      'catalog/templates/a-one',
      'catalog/actions/digest',
    ]) {
      mkdirSync(join(root, path), {recursive: true});
    }
    writeFileSync(join(root, 'catalog/templates/README.md'), 'Notes\n');

    const packages = await discoverPackages({root, config});

    expect(packages.map(({package: name, kind, path}) => ({name, kind, path}))).toEqual([
      {name: 'shipfox/digest', kind: 'action', path: 'catalog/actions/digest'},
      {name: 'shipfox/a-one', kind: 'template', path: 'catalog/templates/a-one'},
      {name: 'shipfox/b-two', kind: 'template', path: 'catalog/templates/b-two'},
    ]);
  });

  it('rejects a directory that is not a valid package name', async () => {
    const root = mkdtempSync(join(tmpdir(), 'discover-'));
    mkdirSync(join(root, 'catalog/actions'), {recursive: true});
    mkdirSync(join(root, 'catalog/templates/Not_A_Slug'), {recursive: true});

    await expect(discoverPackages({root, config})).rejects.toThrow('is not a valid package name');
  });
});

describe('loadConfig', () => {
  it('rejects a pattern that is not a directory glob', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'config-'));
    const path = join(directory, 'registry.config.yaml');
    writeFileSync(
      path,
      'registry: https://api.registry.shipfox.io\nnamespace: shipfox\npackages:\n  - {kind: template, path: catalog/**/x}\n',
    );

    await expect(loadConfig(path)).rejects.toThrow('Invalid registry release config');
  });
});
