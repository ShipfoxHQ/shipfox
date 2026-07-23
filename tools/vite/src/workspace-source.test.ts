import {mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename, join, resolve as resolvePath} from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {workspaceSourceResolver} from './workspace-source.js';

type ResolverContext = {
  environment: {
    config: {
      resolve: {conditions: string[]};
      ssr: {resolve: {conditions: string[]}};
    };
  };
  resolve: ReturnType<typeof vi.fn>;
};

type ResolverHook = (
  this: ResolverContext,
  id: string,
  importer: string | undefined,
  options: {isEntry: boolean; ssr?: boolean},
) => unknown;

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, {force: true, recursive: true});
  }
});

function createFixture(
  imports: Record<string, unknown>,
  files: Record<string, string>,
): {directory: string; importer: string} {
  const directory = mkdtempSync(join(tmpdir(), 'shipfox-vite-workspace-source-'));
  temporaryDirectories.push(directory);
  writeFileSync(
    join(directory, 'package.json'),
    JSON.stringify({name: 'fixture-package', type: 'module', imports}),
  );

  for (const [file, contents] of Object.entries(files)) {
    const path = join(directory, file);
    mkdirSync(resolvePath(path, '..'), {recursive: true});
    writeFileSync(path, contents);
  }

  return {directory, importer: join(directory, 'src/index.ts')};
}

function createContext(conditions = ['workspace-source']): ResolverContext {
  return {
    environment: {
      config: {
        resolve: {conditions},
        ssr: {resolve: {conditions}},
      },
    },
    resolve: vi.fn(async (id: string) => ({id})),
  };
}

function resolveImport(
  context: ResolverContext,
  id: string,
  importer: string,
  ssr = false,
): Promise<unknown> {
  const plugin = workspaceSourceResolver();
  const resolveId = plugin.resolveId as unknown as ResolverHook;
  return Promise.resolve(resolveId.call(context, id, importer, {isEntry: false, ssr}));
}

describe('workspaceSourceResolver', () => {
  it('resolves exact and wildcard package imports through source targets', async () => {
    const fixture = createFixture(
      {
        '#exact': {
          'workspace-source': './src/exact.ts',
          default: './dist/exact.js',
        },
        '#wild/*': {
          'workspace-source': './src/*',
          default: './dist/*',
        },
      },
      {
        'src/index.ts': '',
        'src/exact.ts': '',
        'src/nested/value.ts': '',
      },
    );
    const context = createContext();

    await resolveImport(context, '#exact', fixture.importer);
    await resolveImport(context, '#wild/nested/value.js', fixture.importer);

    expect(context.resolve).toHaveBeenNthCalledWith(
      1,
      join(fixture.directory, 'src/exact.ts'),
      fixture.importer,
      {skipSelf: true},
    );
    expect(context.resolve).toHaveBeenNthCalledWith(
      2,
      join(fixture.directory, 'src/nested/value.js'),
      fixture.importer,
      {skipSelf: true},
    );
  });

  it('preserves nested defaults inside the workspace-source branch', async () => {
    const fixture = createFixture(
      {
        '#nested': {
          'workspace-source': {
            browser: './src/nested.js',
            default: './src/nested.js',
          },
          default: './dist/nested.js',
        },
      },
      {
        'src/index.ts': '',
        'src/nested.ts': '',
      },
    );
    const context = createContext();

    await resolveImport(context, '#nested', fixture.importer);

    expect(context.resolve).toHaveBeenCalledWith(
      join(fixture.directory, 'src/nested.js'),
      fixture.importer,
      {skipSelf: true},
    );
  });

  it('keeps direct package-local test mappings and postfixes', async () => {
    const fixture = createFixture(
      {'#test/*': './test/*'},
      {
        'src/index.ts': '',
        'test/helper.ts': '',
      },
    );
    const context = createContext();

    await resolveImport(context, '#test/helper.js?import#fragment', fixture.importer);

    expect(context.resolve).toHaveBeenCalledWith(
      `${join(fixture.directory, 'test/helper.js')}?import#fragment`,
      fixture.importer,
      {skipSelf: true},
    );
  });

  it('does not claim imports without workspace-source or with dist-only targets', async () => {
    const fixture = createFixture(
      {
        '#source/*': {
          'workspace-source': './src/*',
          default: './dist/*',
        },
        '#dist/*': {
          default: './dist/*',
        },
      },
      {
        'src/index.ts': '',
        'dist/only.js': '',
      },
    );
    const disabledContext = createContext(['default']);
    const enabledContext = createContext();

    await resolveImport(disabledContext, '#source/missing.js', fixture.importer);
    await resolveImport(enabledContext, '#dist/only.js', fixture.importer);

    expect(disabledContext.resolve).not.toHaveBeenCalled();
    expect(enabledContext.resolve).not.toHaveBeenCalled();
  });

  it('rejects targets outside the owning package', async () => {
    const fixture = createFixture(
      {'#outside': {'workspace-source': '../outside.ts'}},
      {
        'src/index.ts': '',
      },
    );
    const outsideDirectory = mkdtempSync(join(tmpdir(), 'shipfox-vite-outside-'));
    temporaryDirectories.push(outsideDirectory);
    writeFileSync(join(outsideDirectory, 'outside.ts'), '');
    const outsideTarget = `../${basename(outsideDirectory)}/outside.ts`;
    const outsidePackage = JSON.parse(
      readFileSync(join(fixture.directory, 'package.json'), 'utf8'),
    ) as {imports: Record<string, unknown>; [key: string]: unknown};
    outsidePackage.imports['#outside'] = {'workspace-source': outsideTarget};
    writeFileSync(join(fixture.directory, 'package.json'), JSON.stringify(outsidePackage));
    const context = createContext();

    await resolveImport(context, '#outside', fixture.importer);

    expect(context.resolve).not.toHaveBeenCalled();
  });

  it('finds the owning manifest through a package-manager-style symlink path', async () => {
    const fixture = createFixture(
      {'#*': {'workspace-source': './src/*', default: './dist/*'}},
      {
        'src/index.ts': '',
        'src/db.ts': '',
      },
    );
    const symlinkDirectory = join(fixture.directory, 'node_modules', 'fixture-package');
    mkdirSync(resolvePath(symlinkDirectory, '..'), {recursive: true});
    symlinkSync(fixture.directory, symlinkDirectory, 'dir');
    const context = createContext();

    await resolveImport(context, '#db.js', join(symlinkDirectory, 'src/index.ts'));

    expect(context.resolve).toHaveBeenCalledWith(
      join(symlinkDirectory, 'src/db.js'),
      join(symlinkDirectory, 'src/index.ts'),
      {skipSelf: true},
    );
  });
});
