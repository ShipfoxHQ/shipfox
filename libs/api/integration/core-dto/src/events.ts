import {z} from 'zod';

export const INTEGRATION_EVENT_RECEIVED = 'integrations.event.received' as const;

const nonEmptyStringSchema = z.string().nonempty();
const isoDateTimeSchema = z.string().datetime();
const requiredUnknownSchema = z.custom<unknown>((value) => value !== undefined);

export const integrationEventReceivedSchema = z.object({
  source: nonEmptyStringSchema,
  event: nonEmptyStringSchema,
  workspaceId: nonEmptyStringSchema,
  connectionId: nonEmptyStringSchema,
  deliveryId: nonEmptyStringSchema,
  receivedAt: isoDateTimeSchema,
  payload: requiredUnknownSchema,
});
export type IntegrationEventReceivedEvent = z.infer<typeof integrationEventReceivedSchema>;

// A source-control push, normalized by the producing provider. Carried both as the
// generic `INTEGRATION_EVENT_RECEIVED` envelope payload (consumed opaquely by triggers)
// and nested inside `INTEGRATION_SOURCE_COMMIT_PUSHED` (consumed by domain modules).
export const sourcePushSchema = z.object({
  externalRepositoryId: nonEmptyStringSchema,
  ref: nonEmptyStringSchema,
  headCommitSha: nonEmptyStringSchema,
  defaultBranch: nonEmptyStringSchema,
  isDefaultBranch: z.boolean(),
});
export type SourcePushPayload = z.infer<typeof sourcePushSchema>;

export const INTEGRATION_SOURCE_COMMIT_PUSHED =
  'integrations.source_control.commit_pushed' as const;

// Typed, provider-agnostic source-control event. The producing provider owns the
// translation from its raw webhook into this shape, so domain consumers never decode
// provider payloads. `isDefaultBranch` is a fact; the branch policy lives in the consumer.
export const integrationSourceCommitPushedSchema = z.object({
  provider: nonEmptyStringSchema,
  workspaceId: nonEmptyStringSchema,
  connectionId: nonEmptyStringSchema,
  deliveryId: nonEmptyStringSchema,
  receivedAt: isoDateTimeSchema,
  push: sourcePushSchema,
});
export type IntegrationSourceCommitPushedEvent = z.infer<
  typeof integrationSourceCommitPushedSchema
>;

export interface SentryIssuePayload {
  action: SentryIssueAction;
  issueId: string;
  shortId: string | null;
  title: string;
  culprit: string | null;
  level: string | null;
  status: string | null;
  platform: string | null;
  webUrl: string | null;
  issueUrl: string | null;
  projectUrl: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
}

// Single source of truth for Sentry issue actions: the sentry-dto webhook schema
// builds its z.enum from this tuple, so accepted webhook actions and the published
// SentryIssuePayload contract cannot drift.
export const SENTRY_ISSUE_ACTIONS = [
  'created',
  'resolved',
  'assigned',
  'archived',
  'unresolved',
] as const;

export type SentryIssueAction = (typeof SENTRY_ISSUE_ACTIONS)[number];

export interface IntegrationsEventMap {
  [INTEGRATION_EVENT_RECEIVED]: IntegrationEventReceivedEvent;
  [INTEGRATION_SOURCE_COMMIT_PUSHED]: IntegrationSourceCommitPushedEvent;
}

export const integrationsEventSchemas = {
  [INTEGRATION_EVENT_RECEIVED]: integrationEventReceivedSchema,
  [INTEGRATION_SOURCE_COMMIT_PUSHED]: integrationSourceCommitPushedSchema,
} satisfies Record<keyof IntegrationsEventMap, z.ZodType>;
