import {z} from 'zod';

export const triggerSchema = z
  .object({
    source: z.string(),
    event: z.string().optional(),
    on: z.union([z.string(), z.array(z.string())]).optional(),
    with: z.record(z.string(), z.unknown()).optional(),
    filter: z.string().optional(),
  })
  .transform((value, ctx) => {
    const event = value.event ?? (value.source === 'manual' ? 'fire' : undefined);
    if (!event) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `event is required for source '${value.source}'`,
        path: ['event'],
      });
      return z.NEVER;
    }
    // Omit (don't set to undefined) so the type matches Trigger under exactOptionalPropertyTypes.
    const result: {
      source: string;
      event: string;
      on?: string | string[];
      with?: Record<string, unknown>;
      filter?: string;
    } = {source: value.source, event};
    if (value.on !== undefined) result.on = value.on;
    if (value.with !== undefined) result.with = value.with;
    if (value.filter !== undefined) result.filter = value.filter;
    return result;
  });

export type TriggerDto = z.infer<typeof triggerSchema>;
