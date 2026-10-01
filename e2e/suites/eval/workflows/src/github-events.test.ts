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
const noRunPattern = /No run started from the signed GitHub deliveries/u;
const unknownEventPattern = /cannot send issues\.opened/u;

function fakeGithub() {
  return {
    sendPullRequestReviewComment: vi.fn(() =>
      Promise.resolve({deliveryId: 'comment-delivery', commentId: 1, threadId: 'PRRT_e2e_1'}),
    ),
    sendPullRequestClosed: vi.fn(() => Promise.resolve({deliveryId: 'closed-delivery'})),
    sendWorkflowRunCompleted: vi.fn(() => Promise.resolve({deliveryId: 'run-delivery'})),
    sendIssueLabeled: vi
      .fn()
      .mockResolvedValueOnce({deliveryId: 'labeled-1'})
      .mockResolvedValueOnce({deliveryId: 'labeled-2'}),
  } as unknown as GithubWebhookSender & {
    sendPullRequestReviewComment: ReturnType<typeof vi.fn>;
    sendPullRequestClosed: ReturnType<typeof vi.fn>;
    sendWorkflowRunCompleted: ReturnType<typeof vi.fn>;
    sendIssueLabeled: ReturnType<typeof vi.fn>;
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

  it('fails a workflow run on the case repository and the pull request the scenario names', async () => {
    const github = fakeGithub();
    const send = createGithubEventSender(github);

    const delivery = await send({
      event: 'workflow_run.completed',
      payload: {
        pull_request: pr,
        actor: 'dependabot[bot]',
        conclusion: 'failure',
        head_commit_message: 'Bump pad from 1.0.0 to 2.0.0',
        run_attempt: 2,
      },
      context,
    });

    expect(delivery).toMatchObject({deliveryId: 'run-delivery'});
    expect(github.sendWorkflowRunCompleted).toHaveBeenCalledWith({
      repository: 'acme/report-cli',
      pullNumbers: [1],
      conclusion: 'failure',
      actor: 'dependabot[bot]',
      headCommitMessage: 'Bump pad from 1.0.0 to 2.0.0',
      runAttempt: 2,
    });
  });

  it('sends a workflow run with no pull request', async () => {
    const github = fakeGithub();
    const send = createGithubEventSender(github);

    await send({event: 'workflow_run.completed', payload: {}, context});

    expect(github.sendWorkflowRunCompleted).toHaveBeenCalledWith(
      expect.objectContaining({repository: 'acme/report-cli', pullNumbers: undefined}),
    );
  });

  it('labels the issue and returns the delivery that started a run', async () => {
    const github = fakeGithub();
    const waitForRun = vi.fn(() => Promise.resolve({id: 'run'}));
    const send = createGithubEventSender(github, {waitForRun} as never);

    const delivery = await send({
      event: 'issues.labeled',
      payload: {issue: 1, label: 'shipfox'},
      context,
    });

    expect(delivery).toEqual({deliveryId: 'labeled-1'});
    expect(github.sendIssueLabeled).toHaveBeenCalledWith({
      issueNumber: 1,
      label: 'shipfox',
      sender: undefined,
    });
    expect(waitForRun).toHaveBeenCalledWith(
      expect.objectContaining({deliveryId: 'labeled-1', projectId: 'project'}),
    );
  });

  it('delivers the label event again when no run started for the first delivery', async () => {
    const github = fakeGithub();
    const waitForRun = vi
      .fn()
      .mockRejectedValueOnce(new Error('no run'))
      .mockResolvedValueOnce({id: 'run'});
    const send = createGithubEventSender(github, {waitForRun} as never);

    const delivery = await send({
      event: 'issues.labeled',
      payload: {issue: 1, label: 'shipfox'},
      context,
    });

    expect(delivery).toEqual({deliveryId: 'labeled-2'});
    expect(github.sendIssueLabeled).toHaveBeenCalledTimes(2);
  });

  it('fails when no delivery starts a run', async () => {
    const waitForRun = vi.fn(() => Promise.reject(new Error('no run')));
    const github = fakeGithub();
    github.sendIssueLabeled.mockResolvedValue({deliveryId: 'labeled-n'});
    const send = createGithubEventSender(github, {waitForRun} as never);

    await expect(
      send({event: 'issues.labeled', payload: {issue: 1, label: 'shipfox'}, context}),
    ).rejects.toThrow(noRunPattern);
    expect(github.sendIssueLabeled).toHaveBeenCalledTimes(6);
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
