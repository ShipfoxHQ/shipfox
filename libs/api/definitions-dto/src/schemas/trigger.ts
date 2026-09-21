import {workflowDocumentSecretKeySchema} from '@shipfox/workflow-document';
import {z} from 'zod';

const triggerSecretsSchema = z
  .record(workflowDocumentSecretKeySchema, workflowDocumentSecretKeySchema)
  .superRefine((secrets, ctx) => {
    if (Object.keys(secrets).length > 20) {
      ctx.addIssue({
        code: 'custom',
        message: 'Trigger secrets cannot contain more than 20 entries.',
      });
    }
  });

export const triggerDtoSchema = z.object({
  source: z.string(),
  event: z.string().optional(),
  with: z.record(z.string(), z.unknown()).optional(),
  secrets: triggerSecretsSchema.optional(),
  filter: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});
export type TriggerDto = z.infer<typeof triggerDtoSchema>;
