import {mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {type ConfigEnv, createServer, type UserConfig} from 'vite';
import {afterEach, describe, expect, it} from 'vitest';
import {defineConfig, type UserConfigExport} from './index.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, {force: true, recursive: true});
  }
});

function resolveConfig(
  configExport: UserConfigExport,
  command: ConfigEnv['command'],
): UserConfig | Promise<UserConfig> {
  if (typeof configExport === 'function') {
    return configExport({command, mode: command === 'serve' ? 'development' : 'production'});
  }
  return configExport;
}

function pluginNames(config: UserConfig): string[] {
  return (config.plugins ?? []).flatMap((plugin) => {
    if (plugin && typeof plugin === 'object' && 'name' in plugin) {
      const name = plugin.name;
      return typeof name === 'string' ? [name] : [];
    }
    return [];
  });
}

describe('@shipfox/vite configuration', () => {
  it('preserves caller plugins and installs the resolver only for serve', async () => {
    const callerPlugin = {name: 'caller-plugin'};
    const serveConfig = await resolveConfig(defineConfig({plugins: [callerPlugin]}), 'serve');
    const buildConfig = await resolveConfig(defineConfig({plugins: [callerPlugin]}), 'build');

    expect(pluginNames(serveConfig)).toEqual([
      'caller-plugin',
      'shipfox:workspace-source-resolver',
    ]);
    expect(pluginNames(buildConfig)).toEqual(['caller-plugin']);
  });

  it('does not reactivate the resolver when callers remove the source condition', async () => {
    const config = await resolveConfig(
      defineConfig({
        resolve: {conditions: ['default']},
        ssr: {resolve: {conditions: ['default']}},
      }),
      'serve',
    );

    expect(pluginNames(config)).toEqual([]);
  });

  it('does not install the resolver for build even when source conditions are explicit', async () => {
    const config = await resolveConfig(
      defineConfig({resolve: {conditions: ['workspace-source']}}),
      'build',
    );

    expect(pluginNames(config)).toEqual([]);
  });

  it('resolves a source package import through Vite during serve', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'shipfox-vite-workspace-source-'));
    temporaryDirectories.push(directory);
    mkdirSync(join(directory, 'src', 'db'), {recursive: true});
    writeFileSync(
      join(directory, 'package.json'),
      JSON.stringify({
        name: 'fixture-vite-package',
        type: 'module',
        imports: {
          '#*': {
            'workspace-source': './src/*',
            default: './dist/*',
          },
        },
      }),
    );
    const importer = join(directory, 'src/index.ts');
    writeFileSync(importer, '');
    writeFileSync(join(directory, 'src/db/db.ts'), '');

    const config = await resolveConfig(
      defineConfig({logLevel: 'silent', root: directory}),
      'serve',
    );
    const server = await createServer({...config, configFile: false});
    try {
      const resolved = await server.pluginContainer.resolveId('#db/db.js', importer);

      expect(resolved?.id).toBe(realpathSync(join(directory, 'src/db/db.ts')));
    } finally {
      await server.close();
    }
  });

  it('resolves a default package export to compiled output during serve', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'shipfox-vite-workspace-default-'));
    temporaryDirectories.push(directory);
    const packageDirectory = join(directory, 'workspace-package');
    mkdirSync(join(packageDirectory, 'dist'), {recursive: true});
    mkdirSync(join(directory, 'src'), {recursive: true});
    mkdirSync(join(directory, 'node_modules'), {recursive: true});
    writeFileSync(
      join(packageDirectory, 'package.json'),
      JSON.stringify({
        name: 'fixture-vite-default-package',
        type: 'module',
        exports: {
          '.': {
            'workspace-source': './src/index.ts',
            default: './dist/index.js',
          },
        },
      }),
    );
    writeFileSync(join(packageDirectory, 'dist/index.js'), '');
    symlinkSync(
      packageDirectory,
      join(directory, 'node_modules', 'fixture-vite-default-package'),
      'dir',
    );
    const importer = join(directory, 'src/index.ts');
    writeFileSync(importer, '');

    const config = await resolveConfig(
      defineConfig({
        logLevel: 'silent',
        resolve: {conditions: ['default']},
        root: directory,
        ssr: {resolve: {conditions: ['default']}},
      }),
      'serve',
    );
    const server = await createServer({...config, configFile: false});
    try {
      const resolved = await server.pluginContainer.resolveId(
        'fixture-vite-default-package',
        importer,
      );

      expect(resolved?.id).toBe(realpathSync(join(packageDirectory, 'dist/index.js')));
    } finally {
      await server.close();
    }
  });
});
