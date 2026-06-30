import {z} from 'zod';

export const githubPushPayloadSchema = z.object({
  ref: z.string().min(1),
  after: z.string().min(1),
  repository: z.object({
    id: z.number().int().positive(),
    default_branch: z.string().min(1),
  }),
  installation: z.object({id: z.number().int().positive()}).optional(),
});
export type GithubPushPayloadDto = z.infer<typeof githubPushPayloadSchema>;

export const githubWebhookActionSchema = z.object({
  action: z.string().min(1).optional(),
});
export type GithubWebhookActionDto = z.infer<typeof githubWebhookActionSchema>;

export const githubWebhookInstallationSchema = z.object({
  installation: z.object({id: z.number().int().positive()}).optional(),
});
export type GithubWebhookInstallationDto = z.infer<typeof githubWebhookInstallationSchema>;

export const githubWebhookEnvelopeSchema = githubWebhookActionSchema.merge(
  githubWebhookInstallationSchema,
);
export type GithubWebhookEnvelopeDto = z.infer<typeof githubWebhookEnvelopeSchema>;
