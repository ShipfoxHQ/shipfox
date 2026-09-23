import {agentThinkingSchema} from '@shipfox/workflow-document';
import {z} from 'zod';

export const modelReferenceSchema = z
  .object({
    thinking: agentThinkingSchema,
    intelligence_index: z.number().finite(),
    cost_per_task_usd: z.number().finite().nonnegative(),
    scale: z.string().min(1),
  })
  .strict();

export type ModelReference = z.infer<typeof modelReferenceSchema>;

export const modelReferencesSchema = z
  .array(modelReferenceSchema)
  .superRefine((references, ctx) => {
    const seen = new Set<string>();
    for (const [index, reference] of references.entries()) {
      if (seen.has(reference.thinking)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'thinking'],
          message: 'Each thinking level can have only one measured reference.',
        });
        continue;
      }
      seen.add(reference.thinking);
    }
  });

export type ModelReferences = z.infer<typeof modelReferencesSchema>;

export const modelPriceSchema = z
  .object({
    input: z.number().finite().nonnegative(),
    output: z.number().finite().nonnegative(),
  })
  .strict();

export type ModelPrice = z.infer<typeof modelPriceSchema>;

export const MODEL_REFERENCE_ATTRIBUTION =
  'Intelligence Index by Artificial Analysis; cost per task is computed from measured token usage at Shipfox list prices.';
