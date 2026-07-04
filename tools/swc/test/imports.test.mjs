import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {rewriteHashImports, rewriteSpecifiers} from '../dist/imports.js';

const imports = {'#test/*': './test/*', '#*': './src/*'};

test('rewriteSpecifiers rewrites a nested #dir/file.js import to a relative path', () => {
  const code = "export {stepSchema} from '#schemas/step.js';\n";

  const result = rewriteSpecifiers(code, 'index.js', imports, 'src');

  assert.equal(result, "export {stepSchema} from './schemas/step.js';\n");
});

test('rewriteSpecifiers rewrites a top-level #file.js import (the SWC-paths blind spot)', () => {
  const code = 'import { connectionSlugSchema } from "#slug.js";\n';

  const result = rewriteSpecifiers(code, 'schemas/integrations.js', imports, 'src');

  assert.equal(result, 'import { connectionSlugSchema } from "../slug.js";\n');
});

test('rewriteSpecifiers normalizes the #/dir/file.js (hash-slash) alias form', () => {
  const code = "import {AuthShell} from '#/components/auth-shell.js';\n";

  const result = rewriteSpecifiers(code, 'pages/logout-page.js', imports, 'src');

  assert.equal(result, "import {AuthShell} from '../components/auth-shell.js';\n");
});

test('rewriteSpecifiers handles side-effect and dynamic imports', () => {
  const code = 'import "#register.js";\nconst m = await import("#core/lazy.js");\n';

  const result = rewriteSpecifiers(code, 'index.js', imports, 'src');

  assert.equal(result, 'import "./register.js";\nconst m = await import("./core/lazy.js");\n');
});

test('rewriteSpecifiers leaves bare imports and non-specifier # strings untouched', () => {
  const code = "import {z} from 'zod';\nconst color = '#ffffff';\n";

  const result = rewriteSpecifiers(code, 'index.js', imports, 'src');

  assert.equal(result, code);
});

test('rewriteSpecifiers leaves conditional (object) import targets untouched', () => {
  const conditional = {'#*': {development: './src/*', default: './dist/*'}};
  const code = "export * from '#schemas/index.js';\n";

  const result = rewriteSpecifiers(code, 'index.js', conditional, 'src');

  assert.equal(result, code);
});

function makeDist({imports: importsMap, files}) {
  const root = mkdtempSync(join(tmpdir(), 'shipfox-swc-dist-'));
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify(importsMap ? {name: 'pkg', imports: importsMap} : {name: 'pkg'}),
  );
  const outputDir = join(root, 'dist');
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(outputDir, rel);
    mkdirSync(join(abs, '..'), {recursive: true});
    writeFileSync(abs, content);
  }
  return {root, outputDir};
}

test('rewriteHashImports rewrites every emitted .js file in place', () => {
  const sourceMap = '{"version":3,"sources":["#schemas/index.js"]}';
  const {root, outputDir} = makeDist({
    imports,
    files: {
      'index.js': "export * from '#schemas/index.js';\n",
      'schemas/integrations.js': "import {slug} from '#slug.js';\n",
      'index.js.map': sourceMap,
    },
  });

  try {
    rewriteHashImports({outputDir, projectRoot: root});

    assert.equal(
      readFileSync(join(outputDir, 'index.js'), 'utf8'),
      "export * from './schemas/index.js';\n",
    );
    assert.equal(
      readFileSync(join(outputDir, 'schemas/integrations.js'), 'utf8'),
      "import {slug} from '../slug.js';\n",
    );
    assert.equal(readFileSync(join(outputDir, 'index.js.map'), 'utf8'), sourceMap);
  } finally {
    rmSync(root, {force: true, recursive: true});
  }
});

test('rewriteHashImports is a no-op when the package declares no imports', () => {
  const {root, outputDir} = makeDist({
    imports: undefined,
    files: {'index.js': "export * from '#schemas/index.js';\n"},
  });

  try {
    rewriteHashImports({outputDir, projectRoot: root});

    assert.equal(
      readFileSync(join(outputDir, 'index.js'), 'utf8'),
      "export * from '#schemas/index.js';\n",
    );
  } finally {
    rmSync(root, {force: true, recursive: true});
  }
});
