import {BootstrapError, loadBootstrap} from '#bootstrap.js';
import {BOOTSTRAP_YAML, createTemporaryRegistry} from '#test/fixtures/registry.js';

describe('loadBootstrap', () => {
  let registry: Awaited<ReturnType<typeof createTemporaryRegistry>>;

  beforeEach(async () => {
    registry = await createTemporaryRegistry();
  });

  afterEach(async () => {
    await registry.cleanup();
  });

  it('loads namespaces, reserved names, and the featured order', async () => {
    const bootstrap = await loadBootstrap(await registry.writeBootstrap());

    expect(bootstrap.featured).toEqual(['shipfox/ticket-to-pr', 'shipfox/slack-thread-digest']);
    expect(bootstrap.reserved).toEqual(['shipfox-*', 'github']);
    expect(bootstrap.namespaces.shipfox?.profile).toEqual({
      display_name: 'Shipfox',
      url: 'https://www.shipfox.io',
      verified: true,
    });
    expect(bootstrap.namespaces.acme?.status).toBe('suspended');
  });

  it.each([
    ['a missing file', undefined, 'ENOENT'],
    ['invalid YAML', 'namespaces: [unclosed', 'Invalid registry bootstrap file'],
    ['an unknown field', `${BOOTSTRAP_YAML}\nfeatures: []\n`, 'Unrecognized key'],
    ['an invalid namespace', 'namespaces: {Shipfox: {profile: {display_name: S}}}', 'namespaces'],
    [
      'a featured package in an undeclared namespace',
      'featured: [other/tool]\nnamespaces: {shipfox: {profile: {display_name: S}}}',
      'names namespace other, which is not declared',
    ],
    [
      'a featured package in a namespace named like an Object property',
      'featured: [constructor/tool]\nnamespaces: {shipfox: {profile: {display_name: S}}}',
      'names namespace constructor, which is not declared',
    ],
    [
      'a publisher without numeric ids',
      BOOTSTRAP_YAML.replace('"812345678"', 'ShipfoxHQ'),
      'repository_id must be a numeric id',
    ],
  ])('refuses %s', async (_case, text, message) => {
    const path =
      text === undefined
        ? `${registry.directory}/missing.yaml`
        : await registry.writeBootstrap(text);

    const load = loadBootstrap(path);

    await expect(load).rejects.toBeInstanceOf(BootstrapError);
    await expect(load).rejects.toThrow(message);
  });
});
