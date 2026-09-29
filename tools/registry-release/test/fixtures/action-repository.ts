import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import type {ConfiguredPackage} from '../../src/config.js';

export const ACTION_PATH = 'libs/catalog/actions/example';

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/**
 * A small pnpm monorepo: an action that bundles a workspace library, which
 * depends on a CommonJS package, plus an unrelated package, a stub
 * `@shipfox/actions`, and root tooling the build tree must drop. The catalog
 * pins versions the repository lockfile also uses, so installs come from the
 * local store.
 */
export const ACTION_REPOSITORY_FILES: Record<string, string> = {
  'package.json': json({
    name: 'fixture-workspace',
    private: true,
    packageManager: 'pnpm@11.7.0',
    type: 'module',
    scripts: {lint: 'echo lint'},
    devDependencies: {'@types/node': 'catalog:'},
  }),
  'pnpm-workspace.yaml': `packages:
  - "libs/**"
catalog:
  "@types/node": "24.13.2"
  ms: "2.1.3"
  yaml: "2.9.0"
overrides:
  ms: "catalog:"
minimumReleaseAge: 2880
`,
  'pnpm-lock.yaml': readFileSync(join(import.meta.dirname, 'action-repository.lock.yaml'), 'utf8'),
  'turbo.json': json({$schema: 'https://turbo.build/schema.json', tasks: {build: {}}}),
  '.gitignore': 'node_modules\ndist\n',
  'libs/format/package.json': json({
    name: '@fixture/format',
    private: true,
    version: '0.0.0',
    type: 'module',
    exports: {'.': {'workspace-source': './src/index.ts', default: './dist/index.js'}},
    dependencies: {ms: 'catalog:'},
  }),
  'libs/format/src/index.ts': `import ms from 'ms';

export function duration(value: number): string {
  return ms(value, {long: true});
}
`,
  'libs/actions/package.json': json({
    name: '@shipfox/actions',
    private: true,
    version: '0.0.0',
    type: 'module',
    exports: {'.': './src/index.ts'},
    dependencies: {yaml: 'catalog:'},
  }),
  'libs/actions/src/index.ts': 'export const defineAction = <Value>(value: Value) => value;\n',
  'libs/unrelated/package.json': json({
    name: '@fixture/unrelated',
    private: true,
    version: '0.0.0',
    dependencies: {yaml: 'catalog:'},
  }),
  [`${ACTION_PATH}/package.json`]: json({
    name: '@fixture/action-example',
    private: true,
    version: '1.0.0',
    license: 'MIT',
    type: 'module',
    dependencies: {'@fixture/format': 'workspace:*'},
    devDependencies: {'@shipfox/actions': 'workspace:*', '@types/node': 'catalog:'},
  }),
  [`${ACTION_PATH}/action.yml`]: `# The example action.
name: Example
description: Formats a duration.
main: src/main.ts
outputs:
  text:
    description: The formatted duration.
`,
  [`${ACTION_PATH}/src/main.ts`]: `import {duration} from '@fixture/format';
import {defineAction} from '@shipfox/actions';

export default defineAction(() => ({text: duration(90_000)}));
`,
  [`${ACTION_PATH}/LICENSE`]: 'MIT License\n',
  [`${ACTION_PATH}/README.md`]: 'Formats a duration.\n',
};

/** A throwaway Git repository holding the fixture monorepo. */
export class ActionRepository {
  readonly root = mkdtempSync(join(tmpdir(), 'registry-release-action-'));

  constructor(files: Record<string, string> = ACTION_REPOSITORY_FILES) {
    this.git('init', '--quiet', '--initial-branch=main');
    this.git('config', 'user.email', 'test@example.com');
    this.git('config', 'user.name', 'Test');
    this.git('config', 'commit.gpgsign', 'false');
    for (const [path, content] of Object.entries(files)) this.write(path, content);
    this.commit();
  }

  get configured(): ConfiguredPackage {
    return {
      package: 'fixture/example',
      kind: 'action',
      root: this.root,
      path: ACTION_PATH,
      directory: join(this.root, ACTION_PATH),
    };
  }

  write(path: string, content: string): void {
    const file = join(this.root, path);
    mkdirSync(dirname(file), {recursive: true});
    writeFileSync(file, content);
  }

  /** Commits every change and returns the commit. */
  commit(): string {
    this.git('add', '--all');
    this.git('commit', '--quiet', '--allow-empty', '-m', 'Update');
    return this.git('rev-parse', 'HEAD').trim();
  }

  remove(): void {
    rmSync(this.root, {recursive: true, force: true});
  }

  private git(...args: string[]): string {
    return execFileSync('git', args, {cwd: this.root, encoding: 'utf8'});
  }
}
