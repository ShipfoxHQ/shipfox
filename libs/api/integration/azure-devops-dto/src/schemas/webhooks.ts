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

/**
 * Every Service Hook notification shares this envelope. `id` is stable across delivery retries.
 * `resourceContainers.project` names the project of every event, including build events whose
 * repository carries no project of its own.
 */
export const azureDevOpsServiceHookEnvelopeSchema = z.object({
  id: z.string().min(1),
  eventType: z.string().min(1),
  resource: z.record(z.string(), z.unknown()),
  resourceContainers: z.object({project: z.object({id: z.string().min(1)}).optional()}).optional(),
});
export type AzureDevOpsServiceHookEnvelopeDto = z.infer<
  typeof azureDevOpsServiceHookEnvelopeSchema
>;

const projectSchema = z.object({id: z.string().min(1), name: z.string().min(1)});

const pushRepositorySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  project: projectSchema,
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
  repository: pushRepositorySchema,
  pushedBy: z.object({uniqueName: z.string().optional()}).optional(),
});
export type AzureDevOpsPushResourceDto = z.infer<typeof azureDevOpsPushResourceSchema>;

/**
 * The repository of a pull-request, comment or build event. Build events name only the
 * repository; their project comes from the envelope's `resourceContainers`.
 */
export const azureDevOpsEventRepositorySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  project: projectSchema.optional(),
});
export type AzureDevOpsEventRepositoryDto = z.infer<typeof azureDevOpsEventRepositorySchema>;
