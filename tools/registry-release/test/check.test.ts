import type {RegistryBump} from '@shipfox/registry-format';
import type {BuiltPackage} from '../src/build.js';
import type {PendingChangeset} from '../src/changesets.js';
import {type CheckMode, runCheck} from '../src/check.js';
import {createRegistryClient} from '../src/registry-client.js';
import {FakeRegistry} from './fixtures/fake-registry.js';
import {publishedActionDocument, publishedDocument} from './fixtures/registry-documents.js';
import {
  TEMPLATE_FILES,
  TEMPLATE_MANIFEST,
  TemplateRepository,
} from './fixtures/template-repository.js';
import {buildFixture} from './helpers.js';

const WORKSPACE_NAME = '@shipfox/template-fixture-template';

function changeset(bump: RegistryBump): PendingChangeset {
  return {file: 'change.md', releases: {[WORKSPACE_NAME]: bump}};
}

function withVersion(version: string): string {
  return (
    TEMPLATE_FILES['package.json']?.replace('"version": "1.0.0"', `"version": "${version}"`) ?? ''
  );
}

describe('check', () => {
  let repository: TemplateRepository;
  let registry: FakeRegistry;

  beforeEach(() => {
    repository = new TemplateRepository();
    registry = new FakeRegistry();
  });
  afterEach(() => repository.remove());

  async function check({
    mode,
    changesets = [],
    packages,
  }: {
    mode: CheckMode;
    changesets?: PendingChangeset[];
    packages?: BuiltPackage[];
  }) {
    return runCheck({
      mode,
      packages: packages ?? [await buildFixture(repository)],
      registry: createRegistryClient({url: 'https://registry.test', fetch: registry.fetch}),
      changesets,
    });
  }

  // Publishes the current files as 1.0.0, then changes them.
  async function publishThenChange(change: () => void): Promise<void> {
    registry.seed(publishedDocument(await buildFixture(repository)));
    change();
    repository.commit();
  }

  function messages(result: Awaited<ReturnType<typeof check>>): string[] {
    return result.findings.map(({level, message}) => `${level}: ${message}`);
  }

  describe('in pr mode', () => {
    it('passes an unpublished package', async () => {
      const result = await check({mode: 'pr'});

      expect(result).toEqual({findings: [], ok: true});
    });

    it('passes a package identical to its published version', async () => {
      registry.seed(publishedDocument(await buildFixture(repository)));

      const result = await check({mode: 'pr'});

      expect(result.ok).toBe(true);
    });

    it('fails a changed package without a changeset', async () => {
      await publishThenChange(() =>
        repository.write('workflow.yml', `${TEMPLATE_FILES['workflow.yml']}# tweak\n`),
      );

      const result = await check({mode: 'pr'});

      expect(result.ok).toBe(false);
      expect(messages(result)).toEqual([
        expect.stringContaining(`bumps ${WORKSPACE_NAME} by at least patch (no pending changeset)`),
      ]);
    });

    it('passes a workflow-only change with a patch changeset', async () => {
      await publishThenChange(() =>
        repository.write('workflow.yml', `${TEMPLATE_FILES['workflow.yml']}# tweak\n`),
      );

      const result = await check({mode: 'pr', changesets: [changeset('patch')]});

      expect(result.ok).toBe(true);
    });

    it('requires a minor bump for a new option choice', async () => {
      await publishThenChange(() =>
        repository.write(
          'template.yaml',
          TEMPLATE_MANIFEST.replace(
            '      - id: none\n        label: Do not update the ticket\n',
            '      - id: none\n        label: Do not update the ticket\n      - id: label\n        label: Add a label\n',
          ),
        ),
      );

      const tooSmall = await check({mode: 'pr', changesets: [changeset('patch')]});
      const enough = await check({mode: 'pr', changesets: [changeset('minor')]});

      expect(messages(tooSmall)).toEqual([
        expect.stringContaining('by at least minor (pending: patch)'),
      ]);
      expect(enough.ok).toBe(true);
    });

    it('requires a major bump when a provider is removed from a role', async () => {
      await publishThenChange(() =>
        repository.write(
          'template.yaml',
          TEMPLATE_MANIFEST.replace('providers: [linear, github]', 'providers: [linear]'),
        ),
      );

      const minor = await check({mode: 'pr', changesets: [changeset('minor')]});
      const major = await check({mode: 'pr', changesets: [changeset('minor'), changeset('major')]});

      expect(messages(minor)).toEqual([expect.stringContaining('by at least major')]);
      expect(major.ok).toBe(true);
    });

    it('ignores a changeset for another package', async () => {
      await publishThenChange(() =>
        repository.write('workflow.yml', `${TEMPLATE_FILES['workflow.yml']}# tweak\n`),
      );

      const result = await check({
        mode: 'pr',
        changesets: [{file: 'other.md', releases: {'@shipfox/template-other': 'major'}}],
      });

      expect(result.ok).toBe(false);
    });
  });

  describe('in release mode', () => {
    it('passes a first version', async () => {
      const result = await check({mode: 'release'});

      expect(result).toEqual({findings: [], ok: true});
    });

    it('passes an existing version with the same fingerprint', async () => {
      registry.seed(publishedDocument(await buildFixture(repository)));

      const result = await check({mode: 'release'});

      expect(result.ok).toBe(true);
    });

    it('fails an existing version whose content changed', async () => {
      await publishThenChange(() =>
        repository.write('workflow.yml', `${TEMPLATE_FILES['workflow.yml']}# tweak\n`),
      );

      const result = await check({mode: 'release'});

      expect(messages(result)).toEqual([
        'error: 1.0.0 is published and this build differs. Bump the version.',
      ]);
    });

    it('fails a new version whose bump is below the computed minimum', async () => {
      await publishThenChange(() => {
        repository.write(
          'template.yaml',
          TEMPLATE_MANIFEST.replace('providers: [linear, github]', 'providers: [linear]'),
        );
        repository.write('package.json', withVersion('1.1.0'));
      });

      const result = await check({mode: 'release'});

      expect(messages(result)).toEqual(
        ['1.0.0 to 1.1.0 is a minor bump, and the changes need at least major.'].map(
          (message) => `error: ${message}`,
        ),
      );
    });

    it('passes a new version that meets the computed minimum', async () => {
      await publishThenChange(() => {
        repository.write('workflow.yml', `${TEMPLATE_FILES['workflow.yml']}# tweak\n`);
        repository.write('package.json', withVersion('1.0.1'));
      });

      const result = await check({mode: 'release'});

      expect(result.ok).toBe(true);
    });

    it('compares a new version with the highest lower published version', async () => {
      const first = await buildFixture(repository);
      registry.seed(publishedDocument(first));
      repository.write('workflow.yml', `${TEMPLATE_FILES['workflow.yml']}# one\n`);
      repository.write('package.json', withVersion('1.0.1'));
      repository.commit();
      registry.seed(publishedDocument(await buildFixture(repository)));
      repository.write(
        'template.yaml',
        TEMPLATE_MANIFEST.replace('providers: [linear, github]', 'providers: [linear]'),
      );
      repository.write('package.json', withVersion('1.0.2'));
      repository.commit();

      const result = await check({mode: 'release'});

      expect(messages(result)).toEqual([
        'error: 1.0.1 to 1.0.2 is a patch bump, and the changes need at least major.',
      ]);
    });

    it('fails a template that uses an action nobody publishes', async () => {
      repository.write(
        'parts/source/github.yml',
        `open_pr: |\n  - key: open_pr\n    uses: shipfox/digest@1.0.0\n`,
      );
      repository.commit();

      const result = await check({mode: 'release'});

      expect(messages(result)).toEqual([
        'error: Uses shipfox/digest@1.0.0, which is not a published action or part of this release.',
      ]);
    });

    it('accepts an action the registry has', async () => {
      registry.seed(publishedActionDocument({package: 'shipfox/digest'}));
      repository.write(
        'parts/source/github.yml',
        `open_pr: |\n  - key: open_pr\n    uses: shipfox/digest@1.0.0\n`,
      );
      repository.commit();

      const result = await check({mode: 'release'});

      expect(result.ok).toBe(true);
    });

    it('rejects a used package that is a template, published or in the same batch', async () => {
      repository.write(
        'parts/source/github.yml',
        `open_pr: |\n  - key: open_pr\n    uses: shipfox/digest@1.0.0\n`,
      );
      repository.commit();
      const template = await buildFixture(repository);
      registry.seed(publishedDocument({...template, package: 'shipfox/digest'}));
      const sibling: BuiltPackage = {
        ...template,
        package: 'shipfox/other',
        version: '2.0.0',
        actions: [],
      };

      const published = await check({mode: 'release'});
      const inBatch = await check({
        mode: 'release',
        packages: [{...template, actions: ['shipfox/other@2.0.0']}, sibling],
      });

      const expected = (reference: string) =>
        `error: Uses ${reference}, which is not a published action or part of this release.`;
      expect(messages(published)).toEqual([expected('shipfox/digest@1.0.0')]);
      expect(messages(inBatch)).toEqual([expected('shipfox/other@2.0.0')]);
    });

    it('accepts an action published in the same batch', async () => {
      repository.write(
        'parts/source/github.yml',
        `open_pr: |\n  - key: open_pr\n    uses: shipfox/digest@1.0.0\n`,
      );
      repository.commit();
      const template = await buildFixture(repository);
      const sibling: BuiltPackage = {
        ...template,
        package: 'shipfox/digest',
        kind: 'action',
        manifest: {description: 'Turns a thread into Markdown.'},
        actions: [],
      };

      const result = await check({mode: 'release', packages: [template, sibling]});

      expect(result.ok).toBe(true);
    });
  });

  describe('in both modes', () => {
    it.each(['pr', 'release'] as const)('reports a missing license in %s mode', async (mode) => {
      repository.write(
        'package.json',
        TEMPLATE_FILES['package.json']?.replace('"license": "MIT",', '') ?? '',
      );
      repository.commit();

      const result = await check({mode});

      expect(messages(result)).toEqual([expect.stringContaining('needs a `license`')]);
    });

    it.each([
      'pr',
      'release',
    ] as const)('warns about an unresolved related name in %s mode without failing', async (mode) => {
      repository.write(
        'template.yaml',
        TEMPLATE_MANIFEST.replace('related: []', 'related: [shipfox/ghost]'),
      );
      repository.commit();

      const result = await check({mode});

      expect(result.ok).toBe(true);
      expect(messages(result)).toEqual([
        'warning: related names shipfox/ghost, which is neither published nor configured.',
      ]);
    });

    it('stays quiet about a related name the registry has', async () => {
      const other = await buildFixture(repository);
      registry.seed(publishedDocument({...other, package: 'shipfox/ghost'}));
      repository.write(
        'template.yaml',
        TEMPLATE_MANIFEST.replace('related: []', 'related: [shipfox/ghost]'),
      );
      repository.commit();

      const result = await check({mode: 'pr'});

      expect(result.findings).toEqual([]);
    });

    it('stays quiet about a related name that is configured', async () => {
      repository.write(
        'template.yaml',
        TEMPLATE_MANIFEST.replace('related: []', 'related: [shipfox/sibling]'),
      );
      repository.commit();
      const template = await buildFixture(repository);
      const sibling = {...template, package: 'shipfox/sibling'};

      const result = await check({mode: 'pr', packages: [template, sibling]});

      expect(result.findings).toEqual([]);
    });
  });
});
