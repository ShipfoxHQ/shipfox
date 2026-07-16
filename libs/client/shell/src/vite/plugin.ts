import {mkdir, readFile, realpath, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import type {Plugin, ResolvedConfig} from 'vite';
import {composeRoutes} from '#compose/compose-routes.js';
import {mergeConfigShapes} from '#compose/merge-config.js';
import {validateProviderIds} from '#compose/validate-providers.js';
import {validateNavigation, validateSettingsSections} from '#compose/validate-registries.js';
import {navigationEntries, settingsEntries} from '#runtime/registries.js';
import {evaluateFeatures, invalidateFeatures} from './evaluate-features.js';
import {generateAppModule} from './generate.js';

const defaultExportPattern = /\bexport\s+default\b|\bexport\s*\{[\s\S]*?\bas\s+default\b[\s\S]*?\}/;

export interface ShipfoxClientCompositionOptions {
  features: string;
  out?: string;
}

function hasDefaultExport(source: string): boolean {
  return defaultExportPattern.test(source);
}

export function shipfoxClientComposition({
  features,
  out = './src/shipfox-app.gen.ts',
}: ShipfoxClientCompositionOptions): Plugin {
  let config: ResolvedConfig | undefined;
  let watchedFiles = new Set<string>();

  const outputPath = () => resolve(config?.root ?? process.cwd(), out);
  const featuresPath = () => resolve(config?.root ?? process.cwd(), features);

  async function assertDefaultRouteExports(
    context: {resolve(source: string, importer?: string): Promise<{id: string} | null>},
    routes: ReturnType<typeof composeRoutes>,
  ): Promise<void> {
    for (const route of routes) {
      const resolvedRoute = await context.resolve(route.impl, outputPath());
      if (!resolvedRoute) {
        throw new Error(
          `Could not resolve route implementation "${route.impl}" for "${route.path}".`,
        );
      }
      const source = await readFile(resolvedRoute.id, 'utf8');
      if (!hasDefaultExport(source)) {
        throw new Error(
          `Route implementation "${route.impl}" for "${route.path}" must export default defineRoute(...).`,
        );
      }
    }
  }

  async function generate(context: {
    addWatchFile(file: string): void;
    resolve(source: string, importer?: string): Promise<{id: string} | null>;
  }): Promise<void> {
    invalidateFeatures(watchedFiles);
    const evaluated = await evaluateFeatures(featuresPath());
    const routes = composeRoutes(evaluated.features);
    validateProviderIds(evaluated.features);
    validateNavigation(
      evaluated.features,
      routes.map((route) => route.path),
    );
    validateSettingsSections(
      evaluated.features,
      routes.map((route) => route.path),
    );
    mergeConfigShapes(evaluated.features);
    await assertDefaultRouteExports(context, routes);

    watchedFiles = new Set(evaluated.loadedFiles);
    for (const file of watchedFiles) context.addWatchFile(file);

    const output = generateAppModule({
      routes,
      navigation: navigationEntries(evaluated.features),
      settingsSections: settingsEntries(evaluated.features),
    });
    const path = outputPath();
    const existing = await readFile(path, 'utf8').catch(() => undefined);
    if (existing === output) return;
    await mkdir(dirname(path), {recursive: true});
    await writeFile(path, output);
  }

  return {
    name: 'shipfox-client-composition',
    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },
    async buildStart() {
      await generate(this);
    },
    async hotUpdate({file}) {
      const resolvedFile = await realpath(file).catch(() => resolve(file));
      if (!watchedFiles.has(resolvedFile)) return;
      await generate(this as unknown as Parameters<typeof generate>[0]);
    },
  };
}
