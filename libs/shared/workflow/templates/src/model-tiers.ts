import {parse as parseYaml} from 'yaml';
import {z} from 'zod';
import {embeddedModelTiers} from './generated/assets.js';

export const modelProfileSchema = z.enum(['balanced', 'economy', 'strongest']);
export const workflowStepRoleSchema = z.enum(['mechanical', 'implementation', 'review']);

const modelPreferenceListSchema = z.array(z.string().min(1)).min(1);
export const modelTiersSchema = z.object({
  balanced: z.object({
    mechanical: modelPreferenceListSchema,
    implementation: modelPreferenceListSchema,
    review: modelPreferenceListSchema,
  }),
  economy: z.object({
    mechanical: modelPreferenceListSchema,
    implementation: modelPreferenceListSchema,
    review: modelPreferenceListSchema,
  }),
  strongest: z.object({
    mechanical: modelPreferenceListSchema,
    implementation: modelPreferenceListSchema,
    review: modelPreferenceListSchema,
  }),
});

export type ModelProfile = z.infer<typeof modelProfileSchema>;
export type WorkflowStepRole = z.infer<typeof workflowStepRoleSchema>;
export type ModelTiers = z.infer<typeof modelTiersSchema>;

export const modelTiers = modelTiersSchema.parse(parseYaml(embeddedModelTiers));

/** Returns the first preferred model that exists in the workspace catalog. */
export function resolveModel(
  profile: ModelProfile,
  role: WorkflowStepRole,
  availableModelIds: readonly string[],
  tiers: ModelTiers = modelTiers,
): string | null {
  const available = new Set(availableModelIds);
  return tiers[profile][role].find((modelId) => available.has(modelId)) ?? null;
}
