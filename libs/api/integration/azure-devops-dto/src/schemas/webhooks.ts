import {z} from 'zod';

export const azureDevOpsPushEventName = 'git.push';

/** Service Hook event types the webhook handler publishes. Any other event is recorded only. */
export const azureDevOpsWebhookEventNames = [
  azureDevOpsPushEventName,
  'git.pullrequest.created',
  'git.pullrequest.updated',
  'git.pullrequest.merged',
  'ms.vss-code.git-pullrequest-comment-event',
  'build.complete',
] as const;
export type AzureDevOpsWebhookEventName = (typeof azureDevOpsWebhookEventNames)[number];

export function isAzureDevOpsWebhookEventName(value: string): value is AzureDevOpsWebhookEventName {
  return azureDevOpsWebhookEventNames.some((name) => name === value);
}

/** Every Service Hook notification shares this envelope; `id` is stable across delivery retries. */
export const azureDevOpsServiceHookEnvelopeSchema = z.object({
  id: z.string().min(1),
  eventType: z.string().min(1),
  resource: z.record(z.string(), z.unknown()),
});
export type AzureDevOpsServiceHookEnvelopeDto = z.infer<
  typeof azureDevOpsServiceHookEnvelopeSchema
>;

const repositorySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  project: z.object({id: z.string().min(1), name: z.string().min(1)}),
  defaultBranch: z.string().min(1).optional(),
});

export const azureDevOpsPushResourceSchema = z.object({
  refUpdates: z
    .array(
      z.object({
        name: z.string().min(1),
        oldObjectId: z.string().optional(),
        newObjectId: z.string().min(1),
      }),
    )
    .min(1),
  repository: repositorySchema,
  pushedBy: z.object({uniqueName: z.string().optional()}).optional(),
});
export type AzureDevOpsPushResourceDto = z.infer<typeof azureDevOpsPushResourceSchema>;

/** The repository of a pull-request, comment or build event, when the payload names one. */
export const azureDevOpsEventRepositorySchema = repositorySchema;
