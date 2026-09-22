import {SENTRY_ISSUE_ACTIONS} from '@shipfox/api-integration-core-dto';
import {z} from 'zod';

// Built from the SENTRY_ISSUE_ACTIONS tuple in core-dto so the accepted webhook
// actions stay in lockstep with the published SentryIssuePayload contract. Sentry
// may add actions without notice; unknown actions are acknowledged and dropped.
export const sentryIssueActionSchema = z.enum(SENTRY_ISSUE_ACTIONS);
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

// Sentry delivers the installation lifecycle under `data.installation` (issue
// webhooks instead carry a top-level `installation`). The signed payload carries
// the same material the browser redirect delivers while unauthenticated. The install
// uuid, the org slug, and the single-use authorization `code`. Only consumed
// fields are validated; `status`/`actor` are tolerated-but-optional. The raw
// `code` is security-sensitive and must never be logged.
export const sentryInstallationWebhookSchema = z.object({
  action: z.enum(['created', 'deleted']),
  // Identifies who performed the install in Sentry. Tolerated for forward-compat
  // but not consumed; never trusted.
  actor: z
    .object({
      type: z.string().optional(),
      id: z.union([z.string(), z.number()]).optional(),
      name: z.string().optional(),
    })
    .optional(),
  data: z.object({
    installation: z.object({
      uuid: z.string().min(1),
      status: z.string().optional(),
      code: z.string().min(1).optional(),
      organization: z.object({slug: z.string().min(1)}).optional(),
    }),
  }),
});
export type SentryInstallationWebhookDto = z.infer<typeof sentryInstallationWebhookSchema>;

const nullableString = (description: string) => z.string().nullable().describe(description);

// The normalized `event` value a workflow receives. Kept in lockstep with the
// SentryIssuePayload contract in core-dto through a compile-time check in the tests.
export const sentryIssueEventPayloadSchema = z.object({
  action: sentryIssueActionSchema.describe('Sentry issue action.'),
  issueId: z.string().describe('Sentry issue ID.'),
  shortId: nullableString('Short Sentry issue ID.'),
  title: z.string().describe('Issue title. Shipfox uses "Sentry issue" when Sentry omits it.'),
  culprit: nullableString('Sentry issue culprit.'),
  level: nullableString('Sentry issue level.'),
  status: nullableString('Sentry issue status.'),
  platform: nullableString('Sentry issue platform.'),
  webUrl: nullableString('Sentry issue page URL.'),
  issueUrl: nullableString('Sentry issue API URL.'),
  projectUrl: nullableString('Sentry project URL.'),
  firstSeenAt: nullableString('Time Sentry first observed the issue.'),
  lastSeenAt: nullableString('Time Sentry last observed the issue.'),
});
export type SentryIssueEventPayloadDto = z.infer<typeof sentryIssueEventPayloadSchema>;
