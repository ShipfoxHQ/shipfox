import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {buildTscEmitCommand} from '../dist/emit.js';

test('builds declaration emit command with noCheck', () => {
  const command = buildTscEmitCommand({
    binPath: '/repo/node_modules/.bin/tsc',
    configFile: '/repo/tsconfig.build.json',
    outDir: '/repo/dist',
  });

  assert.match(command, /--noCheck/);
  assert.ok(command.indexOf('--noCheck') < command.indexOf('--declaration'));
});

test('emits source declarations flat under dist', () => {
  const root = mkdtempSync(join(tmpdir(), 'shipfox-tsc-emit-'));
  const src = join(root, 'src');
  mkdirSync(src, {recursive: true});
  writeFileSync(join(src, 'index.ts'), 'export const value = 1;\n');
  writeFileSync(join(src, 'index.test.ts'), 'const checked: number = 1;\n');
  writeFileSync(
    join(root, 'tsconfig.build.json'),
    JSON.stringify(
      {
        compilerOptions: {
          declaration: true,
          emitDeclarationOnly: true,
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          noEmitOnError: true,
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

  try {
    execFileSync(
      join(process.cwd(), 'node_modules', '.bin', 'tsc'),
      [
        '--project',
        join(root, 'tsconfig.build.json'),
        '--noCheck',
        '--declaration',
        '--emitDeclarationOnly',
        '--outDir',
        join(root, 'dist'),
      ],
      {stdio: 'pipe'},
    );

    assert.equal(existsSync(join(root, 'dist', 'index.d.ts')), true);
    assert.equal(existsSync(join(root, 'dist', 'index.test.d.ts')), false);
    assert.equal(existsSync(join(root, 'dist', 'src')), false);
    assert.equal(existsSync(join(root, 'dist', 'test')), false);
  } finally {
    rmSync(root, {force: true, recursive: true});
  }
});
