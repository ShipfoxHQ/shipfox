import {z} from 'zod';

export const modelReferenceSchema = z
  .object({
    intelligence_index: z.number().finite(),
    cost_per_task_usd: z.number().finite().nonnegative(),
    scale: z.string().min(1),
  })
  .strict();

export type ModelReference = z.infer<typeof modelReferenceSchema>;

export const modelPriceSchema = z
  .object({
    input: z.number().finite().nonnegative(),
    output: z.number().finite().nonnegative(),
  })
  .strict();

export type ModelPrice = z.infer<typeof modelPriceSchema>;

export const MODEL_REFERENCE_ATTRIBUTION =
  'Intelligence Index by Artificial Analysis; cost per task is computed from measured token usage at Shipfox list prices.';
