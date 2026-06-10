import {z} from 'zod';

// The accepted (normalized) issue actions. A raw Sentry `ignored` action is
// mapped to `archived` at the route edge before validation; any still-unknown
// action is record-and-dropped by the route (never a 400) since Sentry may add
// actions over time.
export const sentryIssueActionSchema = z.enum([
  'created',
  'resolved',
  'assigned',
  'archived',
  'unresolved',
]);
export type SentryIssueAction = z.infer<typeof sentryIssueActionSchema>;

// Tolerant schema validating only the fields we read. Zod strips unknown keys,
// so extra Sentry fields pass through harmlessly.
export const sentryIssueWebhookSchema = z.object({
  action: sentryIssueActionSchema,
  installation: z.object({uuid: z.string().min(1)}),
  data: z.object({
    issue: z.object({
      id: z.coerce.string().min(1),
      shortId: z.string().optional(),
      title: z.string().optional(),
      culprit: z.string().nullable().optional(),
      level: z.string().optional(),
      status: z.string().optional(),
      platform: z.string().nullable().optional(),
      web_url: z.string().optional(),
      url: z.string().optional(),
      project_url: z.string().optional(),
      firstSeen: z.string().optional(),
      lastSeen: z.string().optional(),
    }),
  }),
});
export type SentryIssueWebhookDto = z.infer<typeof sentryIssueWebhookSchema>;

// Minimal envelope for the `installation` resource (created/deleted).
export const sentryInstallationWebhookSchema = z.object({
  action: z.enum(['created', 'deleted']),
  installation: z.object({uuid: z.string().min(1)}),
});
export type SentryInstallationWebhookDto = z.infer<typeof sentryInstallationWebhookSchema>;
