import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {registryBlobKey, verifyRegistryVersionEnvelope} from '@shipfox/registry-format';
import {eq} from 'drizzle-orm';
import {createBlobStore} from '#blobs.js';
import {loadBootstrap} from '#bootstrap.js';
import {db} from '#db/db.js';
import {versions} from '#db/schema/versions.js';
import {importBuildOutputs} from '#import/import-builds.js';
import {createVersionImporter, IMPORT_PROVENANCE} from '#publish/publish-version.js';
import {registrySigner} from '#signing-key.js';
import {
  ACTION_DRAFT,
  actionFiles,
  type BundleFixture,
  bundleOf,
  compositeActionFiles,
  sourceArchive,
  TEMPLATE_DRAFT,
  templateFiles,
} from '#test/fixtures/packages.js';
import {createTemporaryRegistry, resetRegistryDatabase} from '#test/fixtures/registry.js';
import {testSigningKey} from '#test/fixtures/signing-key.js';

describe('importBuildOutputs', () => {
  const signingKey = testSigningKey();
  let registry: Awaited<ReturnType<typeof createTemporaryRegistry>>;
  let importVersion: ReturnType<typeof createVersionImporter>;

  beforeEach(async () => {
    registry = await createTemporaryRegistry();
    await resetRegistryDatabase();
    importVersion = createVersionImporter({
      bootstrap: await loadBootstrap(await registry.writeBootstrap()),
      signer: registrySigner(signingKey),
      blobs: createBlobStore(registry.storage),
      hooks: [],
    });
  });

  afterEach(async () => {
    await registry.cleanup();
  });

  const buildsDirectory = () => join(registry.directory, 'builds');

  /** Writes what `shipfox-registry-release build` writes for one version. */
  async function writeBuild({
    name,
    version,
    kind,
    draft,
    content,
    readme,
    actions = [],
  }: {
    name: string;
    version: string;
    kind: 'action' | 'template';
    draft: object;
    content: BundleFixture;
    readme?: string;
    actions?: string[];
  }) {
    const directory = join(buildsDirectory(), 'shipfox', name, version);
    await mkdir(directory, {recursive: true});
    await writeFile(
      join(directory, 'build.json'),
      JSON.stringify({package: `shipfox/${name}`, kind, version, actions}),
    );
    await writeFile(join(directory, 'draft.json'), JSON.stringify(draft));
    await writeFile(join(directory, 'content.gz'), content.gzip);
    await writeFile(join(directory, 'source.gz'), (await sourceArchive()).gzip);
    if (readme !== undefined) await writeFile(join(directory, 'README.md'), readme);
  }

  const writeAction = async (version: string, content?: BundleFixture) =>
    writeBuild({
      name: 'slack-thread-digest',
      version,
      kind: 'action',
      draft: ACTION_DRAFT,
      content: content ?? (await bundleOf(actionFiles())),
      readme: '# Digest\n',
    });

  it('signs and stores each version with import provenance', async () => {
    const content = await bundleOf(actionFiles());
    await writeAction('1.0.0', content);

    const imported = await importBuildOutputs({directory: buildsDirectory(), importVersion});

    expect(imported).toMatchObject([
      {namespace: 'shipfox', name: 'slack-thread-digest', created: true},
    ]);
    const [row] = await db()
      .select()
      .from(versions)
      .where(eq(versions.package, 'shipfox/slack-thread-digest'));
    const {document} = await verifyRegistryVersionEnvelope({
      envelope: row?.envelope as never,
      trustedKeys: [signingKey.publicKey],
      expected: {package: 'shipfox/slack-thread-digest', version: '1.0.0', kind: 'action'},
    });
    expect(document.provenance).toEqual({...IMPORT_PROVENANCE, path: ACTION_DRAFT.path});
    expect(row?.readme).toBe('# Digest\n');
    expect((await registry.storage.get(registryBlobKey(content.digest)))?.body).toEqual(
      content.gzip,
    );
  });

  it('imports actions before the templates that use them, and lower versions first', async () => {
    await writeBuild({
      name: 'ticket-digest',
      version: '1.0.0',
      kind: 'template',
      draft: TEMPLATE_DRAFT,
      content: await bundleOf(
        templateFiles({steps: ['- key: digest', '  uses: shipfox/slack-thread-digest@1.1.0']}),
      ),
    });
    await writeAction('1.1.0', await bundleOf(actionFiles({keywords: ['slack']})));
    await writeAction('1.0.0');

    const imported = await importBuildOutputs({directory: buildsDirectory(), importVersion});

    expect(imported.map(({name, version}) => `${name}@${version}`)).toEqual([
      'slack-thread-digest@1.0.0',
      'slack-thread-digest@1.1.0',
      'ticket-digest@1.0.0',
    ]);
  });

  it('imports a composite action after the action it uses, whatever their names', async () => {
    await writeBuild({
      name: 'aaa-thread-brief',
      version: '1.0.0',
      kind: 'action',
      draft: ACTION_DRAFT,
      content: await bundleOf(compositeActionFiles()),
      actions: ['shipfox/slack-thread-digest@1.0.0'],
    });
    await writeAction('1.0.0');

    const imported = await importBuildOutputs({directory: buildsDirectory(), importVersion});

    expect(imported.map(({name, created}) => ({name, created}))).toEqual([
      {name: 'slack-thread-digest', created: true},
      {name: 'aaa-thread-brief', created: true},
    ]);
  });

  it('imports a lower version first even when it waits for the action it uses', async () => {
    const writeBrief = async (version: string, actions: string[]) =>
      writeBuild({
        name: 'aaa-thread-brief',
        version,
        kind: 'action',
        draft: ACTION_DRAFT,
        content: await bundleOf(
          compositeActionFiles({
            uses: actions.length === 0 ? [] : ['shipfox/slack-thread-digest@1.0.0'],
          }),
        ),
        actions,
      });
    await writeBrief('1.0.0', ['shipfox/slack-thread-digest@1.0.0']);
    await writeBrief('1.0.1', []);
    await writeAction('1.0.0');

    const imported = await importBuildOutputs({directory: buildsDirectory(), importVersion});

    expect(imported.map(({name, version}) => `${name}@${version}`)).toEqual([
      'slack-thread-digest@1.0.0',
      'aaa-thread-brief@1.0.0',
      'aaa-thread-brief@1.0.1',
    ]);
  });

  it('keeps a version that was already imported with the same content', async () => {
    await writeAction('1.0.0');
    await importBuildOutputs({directory: buildsDirectory(), importVersion});

    const imported = await importBuildOutputs({directory: buildsDirectory(), importVersion});

    expect(imported).toMatchObject([{version: '1.0.0', created: false}]);
  });

  it('fails when the directory holds no build', async () => {
    await mkdir(buildsDirectory(), {recursive: true});

    await expect(importBuildOutputs({directory: buildsDirectory(), importVersion})).rejects.toThrow(
      'No build.json',
    );
  });
});
