import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {getMissingTestFiles} from '../dist/test-file-coverage.js';

function createProject(files) {
  const root = mkdtempSync(join(tmpdir(), 'shipfox-tsc-check-'));

  writeFileSync(
    join(root, 'tsconfig.build.json'),
    JSON.stringify(
      {
        compilerOptions: {
          composite: true,
          declaration: true,
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          outDir: 'dist',
          rootDir: 'src',
          target: 'ES2022',
        },
        include: ['src'],
        exclude: ['**/*.test.ts'],
      },
      null,
      2,
    ),
  );

  writeFileSync(
    join(root, 'tsconfig.test.json'),
    JSON.stringify(files.tsconfigTest, null, 2),
  );

  mkdirSync(join(root, 'src'), {recursive: true});
  writeFileSync(join(root, 'src', 'index.ts'), 'export const value = 1;\n');
  writeFileSync(join(root, 'src', 'index.test.ts'), 'const checked: number = 1;\n');

  return root;
}

test('reports test files hidden by an inherited build exclude', () => {
  const root = createProject({
    tsconfigTest: {
      extends: './tsconfig.build.json',
      compilerOptions: {noEmit: true, rootDir: '.'},
      include: ['src'],
    },
  });

  try {
    const missingFiles = getMissingTestFiles(join(root, 'tsconfig.test.json'), root);

    assert.deepEqual(missingFiles, ['src/index.test.ts']);
  } finally {
    rmSync(root, {force: true, recursive: true});
  }
});

test('accepts test configs that clear inherited excludes', () => {
  const root = createProject({
    tsconfigTest: {
      extends: './tsconfig.build.json',
      compilerOptions: {noEmit: true, rootDir: '.'},
      include: ['src'],
      exclude: [],
    },
  });

  try {
    const missingFiles = getMissingTestFiles(join(root, 'tsconfig.test.json'), root);

    assert.deepEqual(missingFiles, []);
  } finally {
    rmSync(root, {force: true, recursive: true});
  }
});
