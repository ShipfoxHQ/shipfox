import {execFileSync} from 'node:child_process';
import {cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {defineConfig, defineProject} from './config.js';

const workspaceSourcePluginName = 'shipfox:workspace-source-resolver';

function pluginNames(config: {plugins?: unknown[]}): string[] {
  return (config.plugins ?? []).flatMap((plugin) => {
    if (plugin && typeof plugin === 'object' && 'name' in plugin) {
      const name = plugin.name;
      return typeof name === 'string' ? [name] : [];
    }
    return [];
  });
}

function linkToolingPackages(consumerDirectory: string): void {
  mkdirSync(join(consumerDirectory, 'node_modules', '@shipfox'), {recursive: true});
  symlinkSync(
    fileURLToPath(new URL('../', import.meta.url)),
    join(consumerDirectory, 'node_modules', '@shipfox', 'vitest'),
    'dir',
  );
  symlinkSync(
    fileURLToPath(new URL('../../vite/', import.meta.url)),
    join(consumerDirectory, 'node_modules', '@shipfox', 'vite'),
    'dir',
  );
}

function runFixture(consumerDirectory: string): string {
  const vitestBinary = fileURLToPath(new URL('../node_modules/.bin/vitest', import.meta.url));
  return execFileSync(vitestBinary, ['run', '--config', 'vitest.config.ts'], {
    cwd: consumerDirectory,
    encoding: 'utf8',
    env: {...process.env, CI: 'true'},
  });
}

describe('Vitest configuration', () => {
  it('preserves caller plugins and installs the shared resolver for source conditions', () => {
    const callerPlugin = {name: 'caller-plugin'};
    const config = defineConfig({plugins: [callerPlugin]}) as {plugins?: unknown[]};

    expect(pluginNames(config)).toEqual(['caller-plugin', workspaceSourcePluginName]);
  });

  it('does not reactivate the resolver when callers remove workspace-source', () => {
    const config = defineConfig({
      plugins: [{name: 'caller-plugin'}],
      resolve: {conditions: ['default']},
      ssr: {resolve: {conditions: ['default']}},
    }) as {plugins?: unknown[]};

    expect(pluginNames(config)).toEqual(['caller-plugin']);
  });

  it('installs the resolver when only SSR retains workspace-source', () => {
    const config = defineConfig({
      resolve: {conditions: ['default']},
      ssr: {resolve: {conditions: ['workspace-source']}},
    }) as {plugins?: unknown[]};

    expect(pluginNames(config)).toEqual([workspaceSourcePluginName]);
  });

  it('installs the same resolver for workspace projects', () => {
    const config = defineProject({}, import.meta.url) as {plugins?: unknown[]};

    expect(pluginNames(config)).toContain(workspaceSourcePluginName);
  });

  it('resolves a clean external-style fixture through the Vitest pipeline', () => {
    const sourceFixture = fileURLToPath(new URL('../test/external-fixture/', import.meta.url));
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'shipfox-vitest-workspace-source-'));
    const consumerDirectory = join(temporaryRoot, 'consumer');
    const packageDirectory = join(temporaryRoot, 'workspace-package');
    const distOnlyPackageDirectory = join(temporaryRoot, 'dist-only-package');

    try {
      cpSync(join(sourceFixture, 'consumer'), consumerDirectory, {recursive: true});
      cpSync(join(sourceFixture, 'workspace-package'), packageDirectory, {recursive: true});
      cpSync(join(sourceFixture, 'dist-only-package'), distOnlyPackageDirectory, {
        recursive: true,
      });
      linkToolingPackages(consumerDirectory);
      mkdirSync(join(consumerDirectory, 'node_modules'), {recursive: true});
      symlinkSync(
        packageDirectory,
        join(consumerDirectory, 'node_modules', 'fixture-workspace-package'),
        'dir',
      );
      symlinkSync(
        distOnlyPackageDirectory,
        join(consumerDirectory, 'node_modules', 'fixture-dist-only-package'),
        'dir',
      );

      expect(runFixture(consumerDirectory)).toContain('1 passed');
    } finally {
      rmSync(temporaryRoot, {force: true, recursive: true});
    }
  });

  it('loads compiled output through the Vitest pipeline with default conditions', () => {
    const sourceFixture = fileURLToPath(new URL('../test/external-fixture/', import.meta.url));
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'shipfox-vitest-workspace-default-'));
    const consumerDirectory = join(temporaryRoot, 'consumer');
    const packageDirectory = join(temporaryRoot, 'workspace-package');

    try {
      cpSync(join(sourceFixture, 'default-consumer'), consumerDirectory, {recursive: true});
      cpSync(join(sourceFixture, 'workspace-package'), packageDirectory, {recursive: true});
      linkToolingPackages(consumerDirectory);
      mkdirSync(join(consumerDirectory, 'node_modules'), {recursive: true});
      symlinkSync(
        packageDirectory,
        join(consumerDirectory, 'node_modules', 'fixture-workspace-package'),
        'dir',
      );

      expect(runFixture(consumerDirectory)).toContain('1 passed');
    } finally {
      rmSync(temporaryRoot, {force: true, recursive: true});
    }
  });
});
