import {z} from 'zod';

export const ANNOTATION_STYLES = ['default', 'info', 'success', 'warning', 'error'] as const;
export const ANNOTATION_CONTEXT_MAX_LENGTH = 255;

const annotationContextSchema = z
  .string()
  .trim()
  .min(1)
  .max(ANNOTATION_CONTEXT_MAX_LENGTH)
  .describe('Caller-chosen annotation key. Trimmed and unique within a job execution.');

export const annotationStyleSchema = z.enum(ANNOTATION_STYLES);

export type AnnotationStyleDto = z.infer<typeof annotationStyleSchema>;

export const annotationDtoSchema = z.object({
  id: z.string().uuid(),
  job_id: z.string().uuid(),
  job_execution_id: z.string().uuid(),
  origin_step_id: z.string().uuid(),
  origin_step_attempt: z.number().int().min(1),
  context: annotationContextSchema,
  style: annotationStyleSchema,
  sequence: z.number().int().min(1),
  body: z.string(),
});

export type AnnotationDto = z.infer<typeof annotationDtoSchema>;

const leasedWriteAnnotationOperationBaseSchema = z.object({
  context: annotationContextSchema,
  style: annotationStyleSchema.default('default'),
});

export const leasedWriteAnnotationOperationSchema = z.union([
  leasedWriteAnnotationOperationBaseSchema.extend({
    op: z.literal('replace').default('replace'),
    body: z.string(),
  }),
  leasedWriteAnnotationOperationBaseSchema.extend({
    op: z.literal('append'),
    body: z.string(),
  }),
  leasedWriteAnnotationOperationBaseSchema.extend({
    op: z.literal('remove'),
    body: z.never().optional(),
  }),
]);

export type LeasedWriteAnnotationOperationDto = z.infer<
  typeof leasedWriteAnnotationOperationSchema
>;

export const leasedWriteAnnotationsBodySchema = z.object({
  step_id: z.string().uuid(),
  attempt: z.number().int().min(1),
  annotations: z.array(leasedWriteAnnotationOperationSchema),
});

export type LeasedWriteAnnotationsBodyDto = z.infer<typeof leasedWriteAnnotationsBodySchema>;

export const leasedWriteAnnotationsResponseSchema = z.object({
  annotations: z.array(
    z.object({
      context: annotationContextSchema,
      id: z.string().uuid().nullable(),
    }),
  ),
  accounting: z.object({
    annotation_count: z.number().int().min(0),
    total_body_bytes: z.number().int().min(0),
  }),
});

export type LeasedWriteAnnotationsResponseDto = z.infer<
  typeof leasedWriteAnnotationsResponseSchema
>;

export const readAnnotationsResponseSchema = z.object({
  annotations: z.array(annotationDtoSchema),
});

export type ReadAnnotationsResponseDto = z.infer<typeof readAnnotationsResponseSchema>;
