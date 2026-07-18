import {mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Plugin, ResolvedConfig} from 'vite';
import {shipfoxClientComposition} from './plugin.js';

const fixtureFeatures = fileURLToPath(new URL('../../test/fixtures/features.ts', import.meta.url));
const testDirectory = fileURLToPath(new URL('../../test', import.meta.url));

type HookHandler<T> = T extends {handler: infer Handler} ? Handler : T;
type BuildStartOptions = Parameters<HookHandler<NonNullable<Plugin['buildStart']>>>[0];
type ConfigResolvedHandler = (config: ResolvedConfig) => void | Promise<void>;

function hookHandler<T>(hook: T): HookHandler<T> {
  return (
    typeof hook === 'object' && hook !== null && 'handler' in hook ? hook.handler : hook
  ) as HookHandler<T>;
}

function configResolvedHandler(hook: NonNullable<Plugin['configResolved']>): ConfigResolvedHandler {
  return hookHandler(hook) as ConfigResolvedHandler;
}

function configure(plugin: Plugin): void {
  if (!plugin.configResolved) {
    throw new Error('Expected the composition plugin to implement configResolved.');
  }
  configResolvedHandler(plugin.configResolved)({
    root: process.cwd(),
  } as ResolvedConfig);
}

function resolveRouteImplementation(source: string): string | undefined {
  const files: Record<string, string> = {
    '#test/default-route-impl.js': join(testDirectory, 'default-route-impl.tsx'),
    '#test/named-route-impl.js': join(testDirectory, 'named-route-impl.tsx'),
    '#test/not-route-impl.js': join(testDirectory, 'not-route-impl.ts'),
    '#test/search-route-impl.js': join(testDirectory, 'search-route-impl.tsx'),
  };
  return files[source];
}

function pluginContext() {
  const watchedFiles: string[] = [];
  return {
    watchedFiles,
    addWatchFile(file: string) {
      watchedFiles.push(file);
    },
    resolve(source: string) {
      const id = resolveRouteImplementation(source);
      return Promise.resolve(id ? {id} : null);
    },
    environment: {
      pluginContainer: {
        resolveId(source: string) {
          const id = resolveRouteImplementation(source);
          return Promise.resolve(id ? {id} : null);
        },
      },
    },
  };
}

async function build(plugin: Plugin, context: ReturnType<typeof pluginContext>): Promise<void> {
  if (!plugin.buildStart) {
    throw new Error('Expected the composition plugin to implement buildStart.');
  }
  await (
    hookHandler(plugin.buildStart) as unknown as (
      this: typeof context,
      options: BuildStartOptions,
    ) => Promise<void>
  ).call(context, {} as BuildStartOptions);
}

describe('shipfoxClientComposition', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'shipfox-client-shell-vite-'));
  });

  afterEach(async () => {
    await rm(directory, {recursive: true, force: true});
  });

  test('generates a static route tree and watches the manifest module graph', async () => {
    const out = join(directory, 'shipfox-app.gen.ts');
    const plugin = shipfoxClientComposition({features: fixtureFeatures, out});
    const context = pluginContext();
    configure(plugin);

    await build(plugin, context);

    await expect(readFile(out, 'utf8')).resolves.toContain(
      'import route0Impl from "#test/search-route-impl.js";',
    );
    expect(context.watchedFiles).toContain(fixtureFeatures);
  });

  test('fails the Vite build with the shared collision message', async () => {
    const features = join(directory, 'features.ts');
    await writeFile(
      features,
      `export const features = [
  {id: 'shipfox.projects', routes: [{path: '/projects', parent: 'root', impl: '#test/default-route-impl.js'}]},
  {id: 'acme.projects', routes: [{path: '/projects', parent: 'root', impl: '#test/default-route-impl.js'}]},
];`,
    );
    const plugin = shipfoxClientComposition({features, out: join(directory, 'shipfox-app.gen.ts')});
    const context = pluginContext();
    configure(plugin);

    await expect(build(plugin, context)).rejects.toThrow(
      'Route "/projects" is contributed by both features "shipfox.projects" and "acme.projects". Set override: true to replace it explicitly.',
    );
  });

  test('rejects route implementations without a default export', async () => {
    const features = join(directory, 'features.ts');
    await writeFile(
      features,
      `export const features = [{id: 'acme.projects', routes: [{path: '/projects', parent: 'root', impl: '#test/not-route-impl.js'}]}];`,
    );
    const plugin = shipfoxClientComposition({features, out: join(directory, 'shipfox-app.gen.ts')});
    const context = pluginContext();
    configure(plugin);

    await expect(build(plugin, context)).rejects.toThrow(
      'Route implementation "#test/not-route-impl.js" for "/projects" must export default defineRoute(...).',
    );
  });

  test('regenerates when a watched manifest changes', async () => {
    const features = join(directory, 'features.ts');
    const contribution = join(directory, 'contribution.ts');
    const out = join(directory, 'shipfox-app.gen.ts');
    await writeFile(
      features,
      `import {feature} from './contribution.ts';
export const features = [feature];`,
    );
    await writeFile(
      contribution,
      `export const feature = {id: 'acme.insights', routes: [{path: '/insights', parent: 'root', impl: '#test/default-route-impl.js'}]};`,
    );
    const plugin = shipfoxClientComposition({features, out});
    const context = pluginContext();
    configure(plugin);

    await build(plugin, context);
    expect(context.watchedFiles).toContain(await realpath(contribution));
    await writeFile(
      contribution,
      `export const feature = {id: 'acme.reports', routes: [{path: '/reports', parent: 'root', impl: '#test/default-route-impl.js'}]};`,
    );
    const hotUpdateContext = {environment: context.environment};
    await (
      plugin.hotUpdate as unknown as (
        this: typeof hotUpdateContext,
        options: {
          file: string;
          server: {watcher: {add(file: string): void}};
        },
      ) => Promise<void>
    ).call(hotUpdateContext, {
      file: contribution,
      server: {
        watcher: {
          add(file: string) {
            context.watchedFiles.push(file);
          },
        },
      },
    });

    await expect(readFile(out, 'utf8')).resolves.toContain('path: "/reports"');
  });
});
