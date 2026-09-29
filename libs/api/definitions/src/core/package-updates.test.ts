import {PACKAGE_UPDATE_CHANGELOG_ENTRY_MAX_LENGTH} from '@shipfox/api-definitions-dto';
import {fakePackageRegistry, packageIndex} from '#test/fixtures/registry-index.js';
import type {RegistryRef} from './entities/registry-ref.js';
import {getPackageUpdates} from './package-updates.js';

const ACTION = 'shipfox/slack-thread-digest';
const TEMPLATE = 'shipfox/ticket-to-pr';

function actionRef(version: string): RegistryRef {
  return {kind: 'action', package: ACTION, version, steps: ['build.digest']};
}

function templateRef(version: string): RegistryRef {
  return {kind: 'template', package: TEMPLATE, version, bindings: {}, options: {}};
}

describe('getPackageUpdates', () => {
  it('reports an action behind, with the highest bump and a capability change over the skipped versions', async () => {
    const registry = fakePackageRegistry({
      indexes: [
        packageIndex({
          package: ACTION,
          kind: 'action',
          versions: [
            ['1.4.2', 'patch'],
            ['1.5.0', 'minor'],
            ['1.5.1', 'patch', true],
            ['2.0.0', 'major'],
          ],
        }),
      ],
    });

    const updates = await getPackageUpdates({
      registryRefs: [actionRef('1.4.2')],
      configPath: '.shipfox/workflows/digest.yml',
      registry,
    });

    expect(updates).toEqual([
      {
        kind: 'action',
        package: ACTION,
        version: '1.4.2',
        latest: '2.0.0',
        behind: true,
        bump: 'major',
        capability_change: true,
        steps: ['build.digest'],
        changelog: [],
      },
    ]);
  });

  it('does not count a capability change at or before the pinned version', async () => {
    const registry = fakePackageRegistry({
      indexes: [
        packageIndex({
          package: ACTION,
          kind: 'action',
          versions: [
            ['1.4.0', 'minor', true],
            ['1.4.2', 'patch'],
            ['1.4.3', 'patch'],
          ],
        }),
      ],
    });

    const [update] = await getPackageUpdates({
      registryRefs: [actionRef('1.4.2')],
      configPath: null,
      registry,
    });

    expect(update).toMatchObject({behind: true, bump: 'patch', capability_change: false});
  });

  it('reports a current version as not behind, with no bump', async () => {
    const registry = fakePackageRegistry({
      indexes: [
        packageIndex({
          package: ACTION,
          kind: 'action',
          versions: [
            ['1.3.0', 'minor'],
            ['1.4.2', 'minor'],
          ],
        }),
      ],
    });

    const updates = await getPackageUpdates({
      registryRefs: [actionRef('1.4.2')],
      configPath: null,
      registry,
    });

    expect(updates).toEqual([
      expect.objectContaining({
        latest: '1.4.2',
        behind: false,
        bump: null,
        capability_change: false,
        changelog: [],
      }),
    ]);
    expect(registry.resolveVersion).not.toHaveBeenCalled();
  });

  it('gives a template the upgrade prompt and the changelog entries after the pinned version', async () => {
    const registry = fakePackageRegistry({
      indexes: [
        packageIndex({
          package: TEMPLATE,
          kind: 'template',
          versions: [
            ['1.2.0', 'minor'],
            ['1.2.1', 'patch'],
            ['1.3.0', 'minor'],
          ],
        }),
      ],
      changelogs: {
        [`${TEMPLATE}@1.2.1`]: undefined,
        [`${TEMPLATE}@1.3.0`]: '### Minor changes\n\n- Adds an option.',
      },
    });

    const updates = await getPackageUpdates({
      registryRefs: [templateRef('1.2.0')],
      configPath: '.shipfox/workflows/ticket.yml',
      registry,
    });

    expect(updates).toEqual([
      {
        kind: 'template',
        package: TEMPLATE,
        version: '1.2.0',
        latest: '1.3.0',
        behind: true,
        bump: 'minor',
        changelog: [{version: '1.3.0', markdown: '### Minor changes\n\n- Adds an option.'}],
        upgrade_prompt:
          'Use Shipfox to upgrade the ticket-to-pr workflow in `.shipfox/workflows/ticket.yml` to 1.3.0.',
      },
    ]);
  });

  it('gives a current template no upgrade prompt', async () => {
    const registry = fakePackageRegistry({
      indexes: [
        packageIndex({package: TEMPLATE, kind: 'template', versions: [['1.2.0', 'minor']]}),
      ],
    });

    const [update] = await getPackageUpdates({
      registryRefs: [templateRef('1.2.0')],
      configPath: null,
      registry,
    });

    expect(update).toMatchObject({behind: false});
    expect(update).not.toHaveProperty('upgrade_prompt');
  });

  it('keeps the newest changelog entries and truncates each one', async () => {
    const versions = ['1.0.1', '1.0.2', '1.0.3', '1.0.4', '1.0.5', '1.0.6', '1.0.7'];
    const registry = fakePackageRegistry({
      indexes: [
        packageIndex({
          package: TEMPLATE,
          kind: 'template',
          versions: [['1.0.0', undefined], ...versions.map((v) => [v, 'patch'] as const)],
        }),
      ],
      changelogs: Object.fromEntries(
        versions.map((version) => [`${TEMPLATE}@${version}`, 'x'.repeat(5000)]),
      ),
    });

    const [update] = await getPackageUpdates({
      registryRefs: [templateRef('1.0.0')],
      configPath: null,
      registry,
    });

    expect(update?.changelog.map((entry) => entry.version)).toEqual([
      '1.0.7',
      '1.0.6',
      '1.0.5',
      '1.0.4',
      '1.0.3',
    ]);
    expect(update?.changelog[0]?.markdown).toHaveLength(PACKAGE_UPDATE_CHANGELOG_ENTRY_MAX_LENGTH);
    expect(update?.changelog[0]?.markdown.endsWith('…')).toBe(true);
  });

  it('skips a legacy header, a package the registry does not know, and one of another kind', async () => {
    const registry = fakePackageRegistry({
      indexes: [packageIndex({package: ACTION, kind: 'template', versions: [['2.0.0', 'major']]})],
    });

    const updates = await getPackageUpdates({
      registryRefs: [
        {kind: 'template', legacy: true, id: 'ticket-to-pr', revision: 5},
        actionRef('1.4.2'),
        {kind: 'action', package: 'shipfox/unknown', version: '1.0.0', steps: []},
      ],
      configPath: null,
      registry,
    });

    expect(updates).toEqual([]);
    expect(registry.getPackageIndex).toHaveBeenCalledTimes(2);
  });

  it('leaves the notice out while the registry is unavailable', async () => {
    const registry = fakePackageRegistry({indexes: [], unavailable: true});

    const updates = await getPackageUpdates({
      registryRefs: [actionRef('1.4.2'), templateRef('1.2.0')],
      configPath: null,
      registry,
    });

    expect(updates).toEqual([]);
  });

  it('reports the update without a changelog when a version cannot be fetched', async () => {
    const registry = fakePackageRegistry({
      indexes: [
        packageIndex({
          package: TEMPLATE,
          kind: 'template',
          versions: [
            ['1.2.0', 'minor'],
            ['1.3.0', 'minor'],
          ],
        }),
      ],
      changelogs: {},
    });

    const [update] = await getPackageUpdates({
      registryRefs: [templateRef('1.2.0')],
      configPath: null,
      registry,
    });

    expect(update).toMatchObject({behind: true, latest: '1.3.0', changelog: []});
  });
});
