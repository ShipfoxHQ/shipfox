import {z} from 'zod';

export const e2eCreateGithubInstallationBodySchema = z.object({
  connection_id: z.string().uuid(),
  installation_id: z.string().min(1),
  account_login: z.string().min(1).optional(),
  account_type: z.string().min(1).optional(),
  repository_selection: z.enum(['all', 'selected']).optional(),
});

export type E2eCreateGithubInstallationBodyDto = z.infer<
  typeof e2eCreateGithubInstallationBodySchema
>;

export const e2eCreateGithubInstallationResponseSchema = z.object({
  installation: z.object({
    id: z.string().uuid(),
    connection_id: z.string().uuid(),
    installation_id: z.string(),
  }),
});

export type E2eCreateGithubInstallationResponseDto = z.infer<
  typeof e2eCreateGithubInstallationResponseSchema
>;
