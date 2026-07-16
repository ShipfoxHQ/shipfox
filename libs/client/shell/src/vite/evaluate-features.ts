import {readFile, realpath} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createJiti} from 'jiti';
import type {ClientFeature} from '#contract.js';

const require = createRequire(import.meta.url);
const importPattern =
  /(?:\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?|\bimport\s*\(\s*)['"]([^'"]+)['"]/g;
const nodeModulesPathPattern = /[\\/]node_modules[\\/]/;

export interface EvaluatedFeatures {
  features: readonly ClientFeature[];
  loadedFiles: readonly string[];
}

export function invalidateFeatures(loadedFiles: Iterable<string>): void {
  for (const file of loadedFiles) delete require.cache[file];
}

function loadedModuleGraph(entry: string): string[] {
  const files = new Set<string>();

  function visit(file: string): void {
    if (files.has(file)) return;
    files.add(file);
    for (const child of require.cache[file]?.children ?? []) visit(child.filename);
  }

  visit(entry);
  return [...files];
}

async function staticallyImportedModules(
  entry: string,
  jiti: ReturnType<typeof createJiti>,
): Promise<string[]> {
  const files = new Set<string>();

  async function visit(file: string): Promise<void> {
    const path = file.startsWith('file:') ? fileURLToPath(file) : file;
    if (path.startsWith('node:') || nodeModulesPathPattern.test(path) || files.has(path)) return;
    const resolvedPath = await realpath(path).catch(() => path);
    files.add(resolvedPath);
    const source = await readFile(resolvedPath, 'utf8').catch(() => undefined);
    if (!source) return;

    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1];
      if (!specifier) continue;
      const dependency = jiti.esmResolve(specifier, {
        parentURL: pathToFileURL(resolvedPath),
        try: true,
      });
      if (dependency) await visit(dependency);
    }
  }

  await visit(entry);
  return [...files];
}

export async function evaluateFeatures(featuresModule: string): Promise<EvaluatedFeatures> {
  const resolvedFeaturesModule = await realpath(resolve(featuresModule));
  const jiti = createJiti(resolvedFeaturesModule, {interopDefault: false, tsconfigPaths: true});
  let module: {default?: unknown; features?: unknown};
  let loadedFiles: string[];
  try {
    module = jiti(resolvedFeaturesModule) as {default?: unknown; features?: unknown};
    loadedFiles = [
      ...new Set([
        ...loadedModuleGraph(resolvedFeaturesModule),
        ...(await staticallyImportedModules(resolvedFeaturesModule, jiti)),
      ]),
    ];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to evaluate features module "${resolvedFeaturesModule}". Features modules must be Node-safe: ${message}`,
      {cause: error},
    );
  }

  const features = module.features ?? module.default;
  if (!Array.isArray(features)) {
    throw new TypeError(
      `Features module "${resolvedFeaturesModule}" must export a features array.`,
    );
  }

  return {features: features as readonly ClientFeature[], loadedFiles};
}
