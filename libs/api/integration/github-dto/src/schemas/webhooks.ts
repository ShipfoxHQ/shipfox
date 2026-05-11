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
