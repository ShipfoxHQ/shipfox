import type {GithubWebhookSender} from '@shipfox/e2e-driver-github';
import {describe, expect, it, vi} from '@shipfox/vitest/vi';
import {createGithubEventSender} from './github-events.js';
import type {EventSenderContext} from './senders.js';

const context: EventSenderContext = {
  workspaceId: 'workspace',
  projectId: 'project',
  connectionId: 'connection',
  token: 'token',
  repository: 'acme/report-cli',
};
const pr = {number: 1, head: 'shipfox/task-1-1-1', base: 'main', sha: 'abc', repository: 'x/y'};
const invalidPayloadPattern = /pull_request_review_comment\.created payload is invalid/u;
const unknownEventPattern = /cannot send issues\.opened/u;

function fakeGithub() {
  return {
    sendPullRequestReviewComment: vi.fn(() =>
      Promise.resolve({deliveryId: 'comment-delivery', commentId: 1, threadId: 'PRRT_e2e_1'}),
    ),
    sendPullRequestClosed: vi.fn(() => Promise.resolve({deliveryId: 'closed-delivery'})),
  } as unknown as GithubWebhookSender & {
    sendPullRequestReviewComment: ReturnType<typeof vi.fn>;
    sendPullRequestClosed: ReturnType<typeof vi.fn>;
  };
}

describe('createGithubEventSender', () => {
  it('sends a review comment on the pull request the scenario names', async () => {
    const github = fakeGithub();
    const send = createGithubEventSender(github);

    const delivery = await send({
      event: 'pull_request_review_comment.created',
      payload: {pull_request: pr, body: 'Rename it.', author_association: 'MEMBER', path: 'a.js'},
      context,
    });

    expect(delivery).toMatchObject({deliveryId: 'comment-delivery'});
    expect(github.sendPullRequestReviewComment).toHaveBeenCalledWith({
      pullNumber: 1,
      body: 'Rename it.',
      author: undefined,
      authorAssociation: 'MEMBER',
      authorType: undefined,
      path: 'a.js',
    });
  });

  it('closes the pull request as merged', async () => {
    const github = fakeGithub();
    const send = createGithubEventSender(github);

    await send({event: 'pull_request.closed', payload: {pull_request: pr, merged: true}, context});

    expect(github.sendPullRequestClosed).toHaveBeenCalledWith({pullNumber: 1, merged: true});
  });

  it('rejects a payload with an unknown field', async () => {
    const send = createGithubEventSender(fakeGithub());

    await expect(
      send({
        event: 'pull_request_review_comment.created',
        payload: {pull_request: pr, body: 'Rename it.', association: 'MEMBER'},
        context,
      }),
    ).rejects.toThrow(invalidPayloadPattern);
  });

  it('rejects an event the fake cannot send', async () => {
    const send = createGithubEventSender(fakeGithub());

    await expect(send({event: 'issues.opened', payload: {}, context})).rejects.toThrow(
      unknownEventPattern,
    );
  });
});
