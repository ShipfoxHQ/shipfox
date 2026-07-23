import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {
  assertOutsideApplicationPublicationClosure,
  compareGuidanceSelection,
  formatGuidanceSelectionDiff,
  type GuidanceManifest,
  parseGuidanceManifest,
  validateManifestFiles,
  validatePackagedMarkdown,
  validatePackageLayout,
  validatePackageManifest,
} from '../src/engineering-guidance-artifact.js';

const roots: string[] = [];
const sourceCommit = '0123456789abcdef0123456789abcdef01234567';
const devDependenciesErrorPattern = /contains devDependencies/u;
const typescriptExportErrorPattern = /exports TypeScript source/u;
const sortedManifestErrorPattern = /sorted by path/u;
const invalidManifestPathErrorPattern = /Invalid files\.0\.path/u;
const extraPackageFileErrorPattern = /undeclared extra file/u;
const hashMismatchErrorPattern = /hash mismatch for repository\/docs\/guide\.md/u;
const missingAnchorErrorPattern = /missing anchor/u;
const bundleEscapeErrorPattern = /escapes the guidance bundle/u;
const staleSourceLinkErrorPattern = /wrong commit/u;
const developmentOnlyToolPattern = /development-only tool/u;

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {force: true, recursive: true});
});

test('reports additions, removals, moves, and reclassification in the guidance selection', () => {
  const diff = compareGuidanceSelection(
    new Map([
      ['repository/docs/old/README.md', 'package'],
      ['repository/docs/shared.md', 'guide'],
      ['repository/docs/policy.md', 'policy'],
    ]),
    new Map([
      ['repository/docs/new/README.md', 'package'],
      ['repository/docs/shared.md', 'architecture'],
      ['repository/docs/extra.md', 'guide'],
    ]),
  );

  assert.deepEqual(diff, {
    added: ['repository/docs/extra.md'],
    moved: [
      {
        from: 'repository/docs/old/README.md',
        kind: 'package',
        to: 'repository/docs/new/README.md',
      },
    ],
    reclassified: [
      {
        actual: 'architecture',
        expected: 'guide',
        path: 'repository/docs/shared.md',
      },
    ],
    removed: ['repository/docs/policy.md'],
  });

  const formatted = formatGuidanceSelectionDiff(diff);
  assert.ok(formatted.includes('+ added to bundle: repository/docs/extra.md'));
  assert.ok(formatted.includes('- missing from bundle: repository/docs/policy.md'));
  assert.ok(
    formatted.includes(
      '~ moved: repository/docs/old/README.md -> repository/docs/new/README.md (package)',
    ),
  );
  assert.ok(
    formatted.includes('! reclassified: repository/docs/shared.md (architecture; expected guide)'),
  );
});

test('keeps engineering guidance out of the application publication closure', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shipfox-engineering-guidance-closure-test-'));
  roots.push(root);
  writeFileSync(
    join(root, 'publication-closure.json'),
    `${JSON.stringify({roots: ['@shipfox/engineering-guidance'], packages: []}, null, 2)}\n`,
  );

  await assert.rejects(
    assertOutsideApplicationPublicationClosure(root),
    developmentOnlyToolPattern,
  );
});

test('rejects unsafe packed package metadata', () => {
  assert.throws(
    () => validatePackageManifest({...validPackageManifest(), devDependencies: {vitest: '^1.0.0'}}),
    devDependenciesErrorPattern,
  );
  assert.throws(
    () => validatePackageManifest({...validPackageManifest(), exports: {'.': './src/index.ts'}}),
    typescriptExportErrorPattern,
  );
});

test('rejects malformed guidance manifests before file validation', () => {
  const first = guidanceManifestFile('repository/docs/a.md');
  const second = guidanceManifestFile('repository/docs/b.md');
  assert.throws(
    () => parseGuidanceManifest({...validGuidanceManifest([second, first])}),
    sortedManifestErrorPattern,
  );
  assert.throws(
    () =>
      parseGuidanceManifest({
        ...validGuidanceManifest([guidanceManifestFile('repository/..\\secret.md')]),
      }),
    invalidManifestPathErrorPattern,
  );
});

test('rejects undeclared packed files and manifest hash mismatches', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shipfox-engineering-guidance-files-test-'));
  roots.push(root);
  mkdirSync(join(root, 'repository', 'docs'), {recursive: true});
  writeFileSync(join(root, 'repository', 'docs', 'guide.md'), '# Guide\n');
  const manifest = validGuidanceManifest([guidanceManifestFile('repository/docs/guide.md')]);

  assert.throws(
    () =>
      validatePackageLayout(
        [
          'LICENSE',
          'README.md',
          'dist/index.d.ts',
          'dist/index.js',
          'dist/manifest.d.ts',
          'dist/manifest.js',
          'dist/bundle/MANIFEST.json',
          'dist/bundle/repository/docs/guide.md',
          'package.json',
          'schema/manifest.schema.json',
          'dist/extra.js',
        ],
        manifest,
      ),
    extraPackageFileErrorPattern,
  );
  await assert.rejects(validateManifestFiles(root, manifest), hashMismatchErrorPattern);
});

test('rejects broken, escaping, and stale source links in packed Markdown', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shipfox-engineering-guidance-markdown-test-'));
  roots.push(root);
  mkdirSync(join(root, 'repository', 'docs'), {recursive: true});
  writeFileSync(join(root, 'repository', 'docs', 'guide.md'), '# Present\n');

  await assert.rejects(
    validatePackagedMarkdown(
      root,
      'repository/docs/index.md',
      '[Guide](guide.md#missing)\n',
      sourceCommit,
    ),
    missingAnchorErrorPattern,
  );
  await assert.rejects(
    validatePackagedMarkdown(
      root,
      'repository/docs/index.md',
      '[Outside](../../outside.md)\n',
      sourceCommit,
    ),
    bundleEscapeErrorPattern,
  );
  await assert.rejects(
    validatePackagedMarkdown(
      root,
      'repository/docs/index.md',
      '[Source](https://github.com/ShipfoxHQ/shipfox/blob/ffffffffffffffffffffffffffffffffffffffff/docs/README.md)\n',
      sourceCommit,
    ),
    staleSourceLinkErrorPattern,
  );
});

function validPackageManifest(): Record<string, unknown> {
  return {
    name: '@shipfox/engineering-guidance',
    version: '1.0.0',
    private: false,
    license: 'MIT',
    type: 'module',
    repository: {
      type: 'git',
      url: 'git+https://github.com/ShipfoxHQ/shipfox.git',
      directory: 'tools/engineering-guidance',
    },
    exports: {'.': './dist/index.js'},
  };
}

function guidanceManifestFile(path: string) {
  return {kind: 'guide', path, sha256: '0'.repeat(64)};
}

function validGuidanceManifest(
  files = [guidanceManifestFile('repository/docs/guide.md')],
): GuidanceManifest {
  return {
    schemaVersion: 1,
    package: {name: '@shipfox/engineering-guidance', version: '1.0.0'},
    source: {repository: 'ShipfoxHQ/shipfox', commit: sourceCommit},
    entrypoints: {documentationMap: files[0]?.path ?? 'repository/docs/guide.md'},
    files,
  };
}
