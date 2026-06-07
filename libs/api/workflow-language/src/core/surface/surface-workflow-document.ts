import {z} from 'zod';

export const surfaceRunStepSchema = z.object({
  run: z.string(),
  name: z.string().optional(),
});

export type SurfaceRunStep = z.infer<typeof surfaceRunStepSchema>;

export const surfaceJobSchema = z.object({
  needs: z.union([z.string(), z.array(z.string())]).optional(),
  runner: z.union([z.string(), z.array(z.string())]).optional(),
  steps: z.array(surfaceRunStepSchema).min(1),
});

export type SurfaceJob = z.infer<typeof surfaceJobSchema>;

// Keep the pre-transform object schema named so docs/tests can verify the authoring shape.
export const surfaceTriggerInputSchema = z.object({
  source: z.string(),
  event: z.string().optional(),
  on: z.union([z.string(), z.array(z.string())]).optional(),
  with: z.record(z.string(), z.unknown()).optional(),
  filter: z.string().optional(),
});

export const surfaceTriggerSchema = surfaceTriggerInputSchema.transform((value, ctx) => {
  const event = value.event ?? (value.source === 'manual' ? 'fire' : undefined);
  if (!event) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `event is required for source '${value.source}'`,
      path: ['event'],
    });
    return z.NEVER;
  }

  // Omit undefined properties so exactOptionalPropertyTypes matches the domain type.
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

export type SurfaceTrigger = z.infer<typeof surfaceTriggerSchema>;

export const surfaceWorkflowDocumentSchema = z
  .object({
    name: z.string().min(1),
    triggers: z.record(z.string(), surfaceTriggerSchema).optional(),
    runner: z.union([z.string(), z.array(z.string())]).optional(),
    jobs: z.record(z.string(), surfaceJobSchema),
  })
  .superRefine((value, ctx) => {
    if (!value.triggers) return;
    const manualNames = Object.entries(value.triggers)
      .filter(([, trigger]) => trigger.source === 'manual')
      .map(([name]) => name);
    if (manualNames.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `a workflow may declare at most one manual trigger; found ${manualNames.length}: ${manualNames.join(', ')}`,
        path: ['triggers'],
      });
    }
  });

export type SurfaceWorkflowDocument = z.infer<typeof surfaceWorkflowDocumentSchema>;

export type SurfaceWorkflowDocumentValidationError = {
  message: string;
  path?: string | undefined;
};

export type SurfaceWorkflowDocumentValidationResult =
  | {valid: true; document: SurfaceWorkflowDocument}
  | {valid: false; errors: SurfaceWorkflowDocumentValidationError[]};

export function validateSurfaceWorkflowDocument(
  value: unknown,
): SurfaceWorkflowDocumentValidationResult {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) {
    return {
      valid: false,
      errors: [{message: 'Workflow definition must be a YAML object'}],
    };
  }

  const result = surfaceWorkflowDocumentSchema.safeParse(value);
  if (!result.success) {
    return {
      valid: false,
      errors: result.error.issues.map((issue) => ({
        message: issue.message,
        path: issue.path.join('.'),
      })),
    };
  }

  return {valid: true, document: result.data};
}
