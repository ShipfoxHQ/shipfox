import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, relative} from 'node:path';

import {
  anchorsFor,
  extractMarkdownLinks,
  generateGuidanceBundle,
  isIncludedGuidancePath,
  validateGeneratedBundle,
} from '../src/generator.js';

const sourceCommit = '0123456789abcdef0123456789abcdef01234567';
const duplicateSourcePathPattern = /Duplicate source path/u;
const missingAnchorPattern = /missing anchor/u;
const traversalPattern = /escapes the repository/u;
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, {force: true, recursive: true})));
});

test('builds the approved documentation roots and recursive Markdown closure', async () => {
  const sourceRoot = await createFixture({
    'AGENTS.md': '[Map](docs/README.md)\n',
    'CONTRIBUTING.md': '# Contributing\n',
    'WRITING.md': '# Writing\n',
    'DESIGN.md': '# Design\n',
    'docs/README.md': `${[
      '# Map',
      '[Client](architecture/client.md)',
      '[Package](../libs/example/README.md#usage)',
      '[Product](../apps/docs/content/product.md)',
      '[Source](../libs/example/src/index.ts)',
    ].join('\n')}\n`,
    'docs/architecture/client.md': '[Backend](backend.md)\n',
    'docs/architecture/backend.md': '[Other package](../../libs/other/README.md)\n',
    'docs/orphan.md': '# Included because docs is an approved root\n',
    'libs/example/README.md': '# Example\n\n## Usage\n\n[Other](../other/README.md)\n',
    'libs/example/src/index.ts': 'export const example = true;\n',
    'libs/other/README.md': '# Other\n',
    'apps/docs/content/product.md': '[Missing](nowhere.md)\n',
    'apps/docs/WRITING.md': '[Missing](nowhere.md)\n',
    '.changeset/example.md': '# Release metadata\n',
    'libs/example/CHANGELOG.md': '# Changelog\n',
    'libs/example/test/README.md': '# Fixture documentation\n',
  });
  const outputRoot = join(sourceRoot, 'generated');

  const result = await generateGuidanceBundle({
    sourceRoot,
    outputRoot,
    packageVersion: '1.0.0',
    sourceCommit,
    availableFiles: await fixtureFiles(sourceRoot),
  });

  assert.deepEqual(result.files, [
    'AGENTS.md',
    'CONTRIBUTING.md',
    'DESIGN.md',
    'WRITING.md',
    'docs/README.md',
    'docs/architecture/backend.md',
    'docs/architecture/client.md',
    'docs/orphan.md',
    'libs/example/README.md',
    'libs/other/README.md',
  ]);
  assert.equal(result.manifest.entrypoints.documentationMap, 'repository/docs/README.md');
  assert.equal(result.manifest.files[0]?.path, 'repository/AGENTS.md');
  assert.equal(
    await readFile(join(outputRoot, 'repository/docs/README.md'), 'utf8'),
    `${[
      '# Map',
      '[Client](architecture/client.md)',
      '[Package](../libs/example/README.md#usage)',
      `[Product](https://github.com/ShipfoxHQ/shipfox/blob/${sourceCommit}/apps/docs/content/product.md)`,
      `[Source](https://github.com/ShipfoxHQ/shipfox/blob/${sourceCommit}/libs/example/src/index.ts)`,
    ].join('\n')}\n`,
  );
  await assert.rejects(readFile(join(outputRoot, 'repository/apps/docs/content/product.md')));
  await validateGeneratedBundle(outputRoot);
});

test('produces byte-identical output for identical inputs', async () => {
  const sourceRoot = await createFixture({
    'docs/README.md': '# Map\n[Guide](guides/guide.md)\n',
    'docs/guides/guide.md': '# Guide\n',
  });
  const firstRoot = join(sourceRoot, 'one');
  const secondRoot = join(sourceRoot, 'two');
  const availableFiles = await fixtureFiles(sourceRoot);

  await generateGuidanceBundle({
    sourceRoot,
    outputRoot: firstRoot,
    packageVersion: '1.0.0',
    sourceCommit,
    availableFiles,
  });
  await generateGuidanceBundle({
    sourceRoot,
    outputRoot: secondRoot,
    packageVersion: '1.0.0',
    sourceCommit,
    availableFiles,
  });

  const firstFiles = await readTree(firstRoot);
  const secondFiles = await readTree(secondRoot);
  assert.deepEqual(firstFiles, secondFiles);
  assert.equal(firstFiles.get('MANIFEST.json'), secondFiles.get('MANIFEST.json'));
});

test('reports invalid anchors and repository traversal attempts', async () => {
  const invalidAnchorRoot = await createFixture({
    'docs/README.md': '[Guide](guide.md#missing)\n',
    'docs/guide.md': '# Present\n',
  });
  await assert.rejects(
    generateGuidanceBundle({
      sourceRoot: invalidAnchorRoot,
      outputRoot: join(invalidAnchorRoot, 'out'),
      packageVersion: '1.0.0',
      sourceCommit,
      availableFiles: await fixtureFiles(invalidAnchorRoot),
    }),
    missingAnchorPattern,
  );

  const traversalRoot = await createFixture({
    'docs/README.md': '[Outside](../../outside.md)\n',
  });
  await assert.rejects(
    generateGuidanceBundle({
      sourceRoot: traversalRoot,
      outputRoot: join(traversalRoot, 'out'),
      packageVersion: '1.0.0',
      sourceCommit,
      availableFiles: await fixtureFiles(traversalRoot),
    }),
    traversalPattern,
  );
});

test('rejects duplicate source paths and disallowed documentation paths', async () => {
  const sourceRoot = await createFixture({'docs/README.md': '# Map\n'});
  await assert.rejects(
    generateGuidanceBundle({
      sourceRoot,
      outputRoot: join(sourceRoot, 'out'),
      packageVersion: '1.0.0',
      sourceCommit,
      availableFiles: ['docs/README.md', './docs/README.md'],
    }),
    duplicateSourcePathPattern,
  );

  assert.equal(isIncludedGuidancePath('apps/docs/content/product.md'), false);
  assert.equal(isIncludedGuidancePath('apps/docs/WRITING.md'), false);
  assert.equal(isIncludedGuidancePath('libs/example/CHANGELOG.md'), false);
  assert.equal(isIncludedGuidancePath('.changeset/example.md'), false);
  assert.equal(isIncludedGuidancePath('libs/example/test/README.md'), false);
  assert.equal(isIncludedGuidancePath('docs/guides/testing.md'), true);
});

test('extracts links with source lines and ignores fenced examples', () => {
  assert.deepEqual(
    extractMarkdownLinks(
      '# Guide\n\nRead [the map](docs/README.md).\n\n```md\n[example](missing.md)\n[example]: missing-reference.md\n```\n',
    ),
    [{line: 3, target: 'docs/README.md'}],
  );
  assert.deepEqual([...anchorsFor('# One\n# One\n')], ['one', 'one-1']);
});

async function createFixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'engineering-guidance-test-'));
  roots.push(root);
  await Promise.all(
    Object.entries(files).map(async ([file, content]) => {
      const filePath = join(root, file);
      await mkdir(join(filePath, '..'), {recursive: true});
      await writeFile(filePath, content);
    }),
  );
  return root;
}

async function fixtureFiles(directory: string, rootDirectory = directory): Promise<string[]> {
  const entries = await readdir(directory, {withFileTypes: true});
  const files = await Promise.all(
    entries.map((entry) => {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) return fixtureFiles(entryPath, rootDirectory);
      return [relative(rootDirectory, entryPath).split('\\').join('/')];
    }),
  );
  return files.flat();
}

async function readTree(root: string): Promise<Map<string, string>> {
  const files = await fixtureFiles(root);
  const values = await Promise.all(
    files.map(async (file) => [file, await readFile(join(root, file), 'utf8')] as const),
  );
  return new Map(values);
}
