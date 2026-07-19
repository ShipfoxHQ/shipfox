import {randomUUID} from 'node:crypto';
import {realpath} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {register} from 'tsx/cjs/api';
import type {ClientFeature} from '#contract.js';

const require = createRequire(import.meta.url);
const nodeModulesPathPattern = /[\\/]node_modules[\\/]/;

export interface EvaluatedFeatures {
  features: readonly ClientFeature[];
  loadedFiles: readonly string[];
}

async function localFiles(paths: Iterable<string>): Promise<string[]> {
  const files = new Set<string>();
  for (const path of paths) {
    if (nodeModulesPathPattern.test(path)) continue;
    files.add(await realpath(path).catch(() => path));
  }
  return [...files];
}

export async function evaluateFeatures(featuresModule: string): Promise<EvaluatedFeatures> {
  const resolvedFeaturesModule = await realpath(resolve(featuresModule));
  const namespace = randomUUID();
  const namespaceQuery = `?namespace=${namespace}`;
  const loader = register({namespace});
  const loadedPaths = new Set<string>([resolvedFeaturesModule]);
  let module: {default?: unknown; features?: unknown};
  try {
    module = loader.require(resolvedFeaturesModule, import.meta.url) as {
      default?: unknown;
      features?: unknown;
    };
    for (const path of Object.keys(require.cache)) {
      if (path.endsWith(namespaceQuery)) {
        loadedPaths.add(path.slice(0, -namespaceQuery.length));
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to evaluate features module "${resolvedFeaturesModule}". Features modules must be Node-safe: ${message}`,
      {cause: error},
    );
  } finally {
    loader.unregister();
    for (const path of Object.keys(require.cache)) {
      if (path.endsWith(namespaceQuery)) delete require.cache[path];
    }
  }

  const features = module.features ?? module.default;
  if (!Array.isArray(features)) {
    throw new TypeError(
      `Features module "${resolvedFeaturesModule}" must export a features array.`,
    );
  }

  return {
    features: features as readonly ClientFeature[],
    loadedFiles: await localFiles(loadedPaths),
  };
}
