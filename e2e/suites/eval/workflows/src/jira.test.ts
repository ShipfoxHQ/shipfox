import {describe, expect, it, vi} from '@shipfox/vitest/vi';
import {createJiraEventSender, prefixJiraWrites} from './jira.js';

const context = {
  workspaceId: 'workspace-1',
  projectId: 'project-1',
  connectionId: 'github-connection',
  token: 'token',
  repository: 'acme/report-cli',
};
const invalidPattern = /payload is invalid/u;
const unsupportedPattern = /cannot send comment_created/u;

describe('createJiraEventSender', () => {
  const postJiraIssueEvent = vi.fn(async () => 'connection-1:delivery-1');
  const sender = createJiraEventSender({
    connectionId: 'jira-connection',
    webhookId: 42,
    siteUrl: 'https://site.atlassian.example.test',
    post: postJiraIssueEvent,
  });

  it('delivers a label event with the issue ID and project taken from the key', async () => {
    const result = await sender({
      event: 'jira:issue_updated',
      context,
      payload: {
        issue: {key: 'ENG-7', summary: 'Add a flag', labels: ['shipfox']},
        previous_labels: [],
      },
    });

    expect(result).toEqual({deliveryId: 'connection-1:delivery-1'});
    expect(postJiraIssueEvent).toHaveBeenCalledWith({
      event: 'jira:issue_updated',
      connectionId: 'jira-connection',
      webhookId: 42,
      actorAccountId: 'eval-jira-user',
      previousStatusName: undefined,
      previousLabels: [],
      issue: {
        id: '10007',
        key: 'ENG-7',
        summary: 'Add a flag',
        statusName: 'To Do',
        projectKey: 'ENG',
        labels: ['shipfox'],
        description: undefined,
        siteUrl: 'https://site.atlassian.example.test',
      },
    });
  });

  it('refuses an issue key the template cannot use as a branch name', async () => {
    await expect(
      sender({
        event: 'jira:issue_created',
        context,
        payload: {issue: {key: 'not a key', summary: 'x'}},
      }),
    ).rejects.toThrow(invalidPattern);
  });

  it('refuses an event it cannot sign', async () => {
    await expect(sender({event: 'comment_created', context, payload: {}})).rejects.toThrow(
      unsupportedPattern,
    );
  });
});

describe('prefixJiraWrites', () => {
  it('names the provider in the kind', () => {
    expect(prefixJiraWrites([{kind: 'add_comment', target: '10007', payload: {}}])).toEqual([
      {kind: 'jira.add_comment', target: '10007', payload: {}},
    ]);
  });
});
