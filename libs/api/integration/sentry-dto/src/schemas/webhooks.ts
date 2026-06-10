import {z} from 'zod';

// Sentry may add actions without notice; unknown actions are acknowledged and dropped.
export const sentryIssueActionSchema = z.enum([
  'created',
  'resolved',
  'assigned',
  'archived',
  'unresolved',
]);
export type SentryIssueAction = z.infer<typeof sentryIssueActionSchema>;

// Sentry sends large webhook envelopes; validating only consumed fields avoids
// coupling ingestion to unrelated provider payload changes.
export const sentryIssueWebhookSchema = z.object({
  action: sentryIssueActionSchema,
  installation: z.object({uuid: z.string().min(1)}),
  data: z.object({
    issue: z.object({
      id: z.coerce.string().min(1),
      shortId: z.string().nullable().optional(),
      title: z.string().optional(),
      culprit: z.string().nullable().optional(),
      level: z.string().nullable().optional(),
      status: z.string().nullable().optional(),
      platform: z.string().nullable().optional(),
      web_url: z.string().nullable().optional(),
      url: z.string().nullable().optional(),
      project_url: z.string().nullable().optional(),
      firstSeen: z.string().nullable().optional(),
      lastSeen: z.string().nullable().optional(),
    }),
  }),
});
export type SentryIssueWebhookDto = z.infer<typeof sentryIssueWebhookSchema>;

export const sentryInstallationWebhookSchema = z.object({
  action: z.enum(['created', 'deleted']),
  installation: z.object({uuid: z.string().min(1)}),
});
export type SentryInstallationWebhookDto = z.infer<typeof sentryInstallationWebhookSchema>;
