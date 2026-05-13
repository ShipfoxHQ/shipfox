import {z} from 'zod';

/**
 * Trigger declaration as it appears in the workflow YAML.
 *
 * `event` is optional on input: when `source` is `manual`, it defaults to
 * `fire`. The transform rejects other sources that omit `event` so the
 * inferred type can keep `event: string`.
 */
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
    // Keep optional fields absent (not `undefined`) so the inferred type
    // stays compatible with the upstream Trigger entity under
    // exactOptionalPropertyTypes.
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
