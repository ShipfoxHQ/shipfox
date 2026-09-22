import {integrationEventCatalogIssues} from '@shipfox/api-integration-core-dto';
import {githubEventCatalog} from './event-catalog.js';

describe('githubEventCatalog', () => {
  it('declares one raw family per webhook event name with an anchored reference', () => {
    expect(integrationEventCatalogIssues(githubEventCatalog)).toEqual([]);
    expect(githubEventCatalog.families.map((family) => family.key)).toEqual([
      'push',
      'pull_request',
      'pull_request_review',
      'pull_request_review_comment',
      'pull_request_review_thread',
      'issue_comment',
      'issues',
      'release',
      'workflow_job',
      'workflow_run',
    ]);
    expect(
      githubEventCatalog.families.find((family) => family.key === 'pull_request')?.payloadDocUrl,
    ).toBe('https://docs.github.com/en/webhooks/webhook-events-and-payloads#pull_request');
  });

  it('names action events as family.action', () => {
    expect(githubEventCatalog.events[0]).toEqual({
      name: 'push',
      family: 'push',
      summary: 'A branch or tag changes.',
    });
    expect(githubEventCatalog.events[1]).toMatchObject({
      name: 'pull_request.opened',
      family: 'pull_request',
    });
  });
});
