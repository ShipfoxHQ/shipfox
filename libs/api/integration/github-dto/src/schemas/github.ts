import {
  integrationConnectionDtoSchema,
  updateIntegrationConnectionLifecycleStatusSchema,
} from '@shipfox/api-integration-core-dto';
import {z} from 'zod';

export const createGithubInstallBodySchema = z.object({
  workspace_id: z.string().uuid(),
});
export type CreateGithubInstallBodyDto = z.infer<typeof createGithubInstallBodySchema>;

export const createGithubInstallResponseSchema = z.object({
  install_url: z.string().url(),
});
export type CreateGithubInstallResponseDto = z.infer<typeof createGithubInstallResponseSchema>;

export const createGithubLinkBodySchema = createGithubInstallBodySchema;
export type CreateGithubLinkBodyDto = z.infer<typeof createGithubLinkBodySchema>;

export const createGithubLinkResponseSchema = z.object({
  authorize_url: z.string().url(),
});
export type CreateGithubLinkResponseDto = z.infer<typeof createGithubLinkResponseSchema>;

export const completeGithubLinkBodySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});
export type CompleteGithubLinkBodyDto = z.infer<typeof completeGithubLinkBodySchema>;

/** The picker is a short list: more candidates than this is a typed conflict instead. */
export const GITHUB_LINK_SELECTION_MAX_CANDIDATES = 20;

export const githubLinkCandidateSchema = z.object({
  installation_id: z.number().int().positive(),
  account_login: z.string().min(1),
  account_type: z.string().min(1),
  repository_selection: z.string().min(1),
});
export type GithubLinkCandidateDto = z.infer<typeof githubLinkCandidateSchema>;

export const githubLinkSelectionResponseSchema = z.object({
  candidates: z.array(githubLinkCandidateSchema).min(2).max(GITHUB_LINK_SELECTION_MAX_CANDIDATES),
  selection_token: z.string().min(1),
});
export type GithubLinkSelectionResponseDto = z.infer<typeof githubLinkSelectionResponseSchema>;

export const completeGithubLinkResponseSchema = z.union([
  integrationConnectionDtoSchema,
  githubLinkSelectionResponseSchema,
]);
export type CompleteGithubLinkResponseDto = z.infer<typeof completeGithubLinkResponseSchema>;

export const selectGithubLinkBodySchema = z.object({
  selection_token: z.string().min(1).max(4096),
  installation_id: z.number().int().positive(),
});
export type SelectGithubLinkBodyDto = z.infer<typeof selectGithubLinkBodySchema>;

export const selectGithubLinkResponseSchema = integrationConnectionDtoSchema;
export type SelectGithubLinkResponseDto = z.infer<typeof selectGithubLinkResponseSchema>;

export const githubCallbackQuerySchema = z.object({
  code: z.string().min(1),
  installation_id: z.coerce.number().int().positive(),
  state: z.string().min(1),
  setup_action: z.string().optional(),
});
export type GithubCallbackQueryDto = z.infer<typeof githubCallbackQuerySchema>;

export const githubCallbackResponseSchema = integrationConnectionDtoSchema;
export type GithubCallbackResponseDto = z.infer<typeof githubCallbackResponseSchema>;

export const createE2eGithubConnectionBodySchema = z.object({
  workspace_id: z.string().uuid(),
  installation_id: z.number().int().positive(),
  account_login: z.string().min(1),
  display_name: z.string().min(1),
  installer_user_id: z.string().uuid(),
  lifecycle_status: updateIntegrationConnectionLifecycleStatusSchema.optional(),
});
export type CreateE2eGithubConnectionBodyDto = z.infer<typeof createE2eGithubConnectionBodySchema>;

export const createE2eGithubConnectionResponseSchema = integrationConnectionDtoSchema;
export type CreateE2eGithubConnectionResponseDto = z.infer<
  typeof createE2eGithubConnectionResponseSchema
>;
