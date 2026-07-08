import {integrationConnectionDtoSchema} from '@shipfox/api-integration-core-dto';
import {z} from 'zod';

export const LINEAR_PROVIDER = 'linear';

export type LinearProvider = typeof LINEAR_PROVIDER;

export const createLinearInstallBodySchema = z.object({
  workspace_id: z.string().uuid(),
});
export type CreateLinearInstallBodyDto = z.infer<typeof createLinearInstallBodySchema>;

export const createLinearInstallResponseSchema = z.object({
  install_url: z.string().url(),
});
export type CreateLinearInstallResponseDto = z.infer<typeof createLinearInstallResponseSchema>;

export const linearCallbackQuerySchema = z.union([
  z.object({
    code: z.string().min(1),
    state: z.string().min(1),
  }),
  z.object({
    error: z.string().min(1),
    error_description: z.string().min(1).optional(),
    state: z.string().min(1),
  }),
]);
export type LinearCallbackQueryDto = z.infer<typeof linearCallbackQuerySchema>;

export const linearCallbackResponseSchema = integrationConnectionDtoSchema;
export type LinearCallbackResponseDto = z.infer<typeof linearCallbackResponseSchema>;
