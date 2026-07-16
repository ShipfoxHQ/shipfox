import type {z} from 'zod';
import {shellConfigShape} from '#config/shell-config.js';
import type {ClientFeature} from '#contract.js';
import {ConfigCompositionError} from './errors.js';

export function mergeConfigShapes(features: readonly ClientFeature[]): z.ZodRawShape {
  const merged = {...shellConfigShape} as Record<string, z.ZodRawShape[string]>;
  const owners = new Map<string, string>(
    Object.keys(shellConfigShape).map((key) => [key, 'shell']),
  );
  for (const feature of features) {
    for (const [key, schema] of Object.entries(feature.configShape ?? {})) {
      const existing = merged[key];
      if (existing && existing !== schema) {
        const existingFeatureId = owners.get(key) ?? 'shell';
        throw new ConfigCompositionError(
          key,
          `Config key "${key}" is contributed by both features "${existingFeatureId}" and "${feature.id}". Reuse the same schema instance to intentionally share it.`,
          [existingFeatureId, feature.id],
        );
      }
      merged[key] = schema;
      owners.set(key, feature.id);
    }
  }
  return merged as z.ZodRawShape;
}
