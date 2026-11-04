import {integrationConnectionDtoSchema} from '@shipfox/api-integration-core-dto';
import {z} from 'zod';

/**
 * Azure DevOps organization names: English letters, digits and hyphens, starting and ending with a
 * letter or digit, and under 50 characters.
 * https://learn.microsoft.com/azure/devops/organizations/settings/naming-restrictions#organization-names
 */
export const AZURE_DEVOPS_ORGANIZATION_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,47}[A-Za-z0-9])?$/;

const organizationSchema = z
  .string()
  .trim()
  .regex(AZURE_DEVOPS_ORGANIZATION_PATTERN, 'Invalid Azure DevOps organization');

export const createAzureDevOpsConnectionBodySchema = z.object({
  workspace_id: z.string().uuid(),
  organization: organizationSchema,
  // A personal access token with Code (read & write) and Pull Request Threads scopes. It is
  // stored in workspace secrets and never returned.
  token: z.string().trim().min(1).max(4096),
});
export type CreateAzureDevOpsConnectionBodyDto = z.infer<
  typeof createAzureDevOpsConnectionBodySchema
>;

// Service Hooks do not sign payloads, so each connection gets its own basic-auth credentials for
// its hooks. Every connect call returns a new password and invalidates the previous one, so the
// hooks configured in Azure DevOps must be updated after connecting again.
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
