import {realpath} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import type {ClientFeature} from '#contract.js';

const require = createRequire(import.meta.url);

export interface EvaluatedFeatures {
  features: readonly ClientFeature[];
  loadedFiles: readonly string[];
}

export function invalidateFeatures(loadedFiles: Iterable<string>): void {
  for (const file of loadedFiles) delete require.cache[file];
}

export async function evaluateFeatures(featuresModule: string): Promise<EvaluatedFeatures> {
  const resolvedFeaturesModule = await realpath(resolve(featuresModule));
  const jiti = createJiti(resolvedFeaturesModule, {interopDefault: false, tsconfigPaths: true});
  const cachedModules = new Set(Object.keys(require.cache));

  let module: {default?: unknown; features?: unknown};
  let loadedFiles: string[];
  try {
    module = jiti(resolvedFeaturesModule) as {default?: unknown; features?: unknown};
    loadedFiles = Object.keys(require.cache).filter(
      (file) => !cachedModules.has(file) || file === resolvedFeaturesModule,
    );
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
