import {z} from 'zod';

export const annotationStyleSchema = z.enum(['default', 'info', 'success', 'warning', 'error']);

export type AnnotationStyleDto = z.infer<typeof annotationStyleSchema>;

export const annotationDtoSchema = z.object({
  id: z.string().uuid(),
  job_id: z.string().uuid(),
  job_execution_id: z.string().uuid(),
  origin_step_id: z.string().uuid(),
  origin_step_attempt: z.number().int().min(1),
  context: z.string().min(1),
  style: annotationStyleSchema,
  sequence: z.number().int().min(1),
  body: z.string(),
});

export type AnnotationDto = z.infer<typeof annotationDtoSchema>;

export const leasedWriteAnnotationOperationSchema = z.object({
  context: z.string().min(1),
  style: annotationStyleSchema.default('default'),
  op: z.enum(['replace', 'append', 'remove']).default('replace'),
  body: z.string().optional(),
});

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
      context: z.string().min(1),
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
