import {
  integrationEventCatalogIssues,
  SENTRY_ISSUE_ACTIONS,
  type SentryIssuePayload,
} from '@shipfox/api-integration-core-dto';
import {type SentryIssueEventPayloadDto, sentryEventCatalog} from './index.js';

// The normalized payload schema and the published contract must describe the same value.
const toContract: SentryIssuePayload = {} as SentryIssueEventPayloadDto;
const fromContract: SentryIssueEventPayloadDto = {} as SentryIssuePayload;

describe('sentryEventCatalog', () => {
  it('lists one issue event per accepted action', () => {
    expect(sentryEventCatalog.events.map((event) => event.name)).toEqual(
      SENTRY_ISSUE_ACTIONS.map((action) => `issue.${action}`),
    );
    expect([toContract, fromContract]).toHaveLength(2);
  });

  it('documents the normalized issue family with its schema', () => {
    expect(integrationEventCatalogIssues(sentryEventCatalog)).toEqual([]);
    expect(sentryEventCatalog.families[0].payloadSchema).toMatchObject({
      properties: {action: {enum: [...SENTRY_ISSUE_ACTIONS]}},
    });
  });
});
