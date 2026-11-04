import {integrationConnectionDtoSchema} from '@shipfox/api-integration-core-dto';
import {z} from 'zod';

// Azure DevOps organization names: letters, digits and hyphens, not starting or ending with a hyphen.
const organizationSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,48}[A-Za-z0-9])?$/, 'Invalid Azure DevOps organization');

export const createAzureDevOpsConnectionBodySchema = z.object({
  workspace_id: z.string().uuid(),
  organization: organizationSchema,
  // A personal access token with Code (read & write) and Pull Request Threads scopes, or a
  // service account token. It is stored in workspace secrets and never returned.
  token: z.string().trim().min(1).max(4096),
});
export type CreateAzureDevOpsConnectionBodyDto = z.infer<
  typeof createAzureDevOpsConnectionBodySchema
>;

// Service Hooks do not sign payloads, so each connection gets its own basic-auth credentials for
// the hook. The password is returned once, when the connection is created.
export const azureDevOpsServiceHookSetupSchema = z.object({
  url: z.string().url(),
  username: z.string().min(1),
  password: z.string().min(1),
});
export type AzureDevOpsServiceHookSetupDto = z.infer<typeof azureDevOpsServiceHookSetupSchema>;

export const createAzureDevOpsConnectionResponseSchema = integrationConnectionDtoSchema.extend({
  service_hook: azureDevOpsServiceHookSetupSchema.optional(),
});
export type CreateAzureDevOpsConnectionResponseDto = z.infer<
  typeof createAzureDevOpsConnectionResponseSchema
>;
