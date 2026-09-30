import {createHmac} from 'node:crypto';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {createServer, type IncomingMessage} from 'node:http';
import type {AddressInfo} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startGithubApiMock} from './github-api.js';

const SECRET = 'test-webhook-secret';
const INSTALLATION_ID = 4242;

interface Delivery {
  event: string | undefined;
  deliveryId: string | undefined;
  signature: string | undefined;
  rawBody: string;
  payload: {comment?: {path?: string; in_reply_to_id?: number}} & Record<string, unknown>;
}

function expectedSignature(rawBody: string): string {
  return `sha256=${createHmac('sha256', SECRET).update(rawBody).digest('hex')}`;
}

async function startApi(): Promise<{
  url: string;
  deliveries: Delivery[];
  stop: () => Promise<void>;
}> {
  const deliveries: Delivery[] = [];
  const server = createServer((request: IncomingMessage, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      deliveries.push({
        event: request.headers['x-github-event'] as string | undefined,
        deliveryId: request.headers['x-github-delivery'] as string | undefined,
        signature: request.headers['x-hub-signature-256'] as string | undefined,
        rawBody,
        payload: JSON.parse(rawBody),
      });
      response.writeHead(204).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const {port} = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    deliveries,
    stop: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

describe('GitHub API mock webhook events', () => {
  it('delivers a signed review comment built from the fake pull request state', async () => {
    const api = await startApi();
    const mock = await startGithubApiMock({
      endpoint: new URL('http://127.0.0.1:0'),
      installationId: INSTALLATION_ID,
      webhookSecret: SECRET,
      apiUrl: api.url,
    });

    try {
      mock.pullRequests.set(7, {repository: 'acme/app', ref: 'feature', sha: 'a'.repeat(40)});
      const sent = await mock.sendPullRequestReviewComment({
        pullNumber: 7,
        body: 'Rename the flag.',
        path: 'src/report.ts',
      });

      const [delivery] = api.deliveries;
      expect(api.deliveries).toHaveLength(1);
      expect(delivery?.event).toBe('pull_request_review_comment');
      expect(delivery?.deliveryId).toBe(sent.deliveryId);
      expect(delivery?.signature).toBe(expectedSignature(delivery?.rawBody ?? ''));
      expect(delivery?.payload).toMatchObject({
        action: 'created',
        installation: {id: INSTALLATION_ID},
        repository: {full_name: 'acme/app'},
        pull_request: {
          number: 7,
          state: 'open',
          head: {ref: 'feature', repo: {full_name: 'acme/app'}},
          base: {ref: 'main', repo: {full_name: 'acme/app'}},
        },
        comment: {
          id: sent.commentId,
          body: 'Rename the flag.',
          path: 'src/report.ts',
          author_association: 'MEMBER',
          user: {login: 'e2e-reviewer', type: 'User'},
        },
      });
      expect(delivery?.payload.comment?.in_reply_to_id).toBeUndefined();
      expect(mock.reviewThreads.get(sent.threadId)).toEqual({
        pullNumber: 7,
        path: 'src/report.ts',
        comments: [{id: sent.commentId, body: 'Rename the flag.', author: 'e2e-reviewer'}],
      });
    } finally {
      await mock.stop();
      await api.stop();
    }
  });

  it('numbers each review comment after the ones the fake already holds', async () => {
    const api = await startApi();
    const mock = await startGithubApiMock({
      endpoint: new URL('http://127.0.0.1:0'),
      installationId: INSTALLATION_ID,
      webhookSecret: SECRET,
      apiUrl: api.url,
    });

    try {
      mock.pullRequests.set(1, {repository: 'acme/app', ref: 'feature', sha: 'a'.repeat(40)});
      mock.reviewThreads.set('PRRT_seed', {
        pullNumber: 1,
        path: 'src/seed.ts',
        comments: [{id: 10, body: 'Seed.', author: 'someone'}],
      });
      const first = await mock.sendPullRequestReviewComment({pullNumber: 1, body: 'One.'});
      const second = await mock.sendPullRequestReviewComment({pullNumber: 1, body: 'Two.'});

      expect([first.commentId, second.commentId]).toEqual([11, 12]);
      expect(api.deliveries[0]?.payload.comment?.path).toBe('src/seed.ts');
    } finally {
      await mock.stop();
      await api.stop();
    }
  });

  it('closes the fake pull request and delivers a signed pull_request.closed', async () => {
    const api = await startApi();
    const mock = await startGithubApiMock({
      endpoint: new URL('http://127.0.0.1:0'),
      installationId: INSTALLATION_ID,
      webhookSecret: SECRET,
      apiUrl: api.url,
    });

    try {
      mock.pullRequests.set(3, {repository: 'acme/app', ref: 'feature', sha: 'b'.repeat(40)});
      const sent = await mock.sendPullRequestClosed({pullNumber: 3, merged: true});

      const [delivery] = api.deliveries;
      expect(delivery?.event).toBe('pull_request');
      expect(delivery?.deliveryId).toBe(sent.deliveryId);
      expect(delivery?.signature).toBe(expectedSignature(delivery?.rawBody ?? ''));
      expect(delivery?.payload).toMatchObject({
        action: 'closed',
        number: 3,
        installation: {id: INSTALLATION_ID},
        pull_request: {number: 3, state: 'closed', merged: true},
      });
      expect(mock.pullRequests.get(3)).toMatchObject({state: 'closed', merged: true});
      await expect(mock.sendPullRequestClosed({pullNumber: 3})).rejects.toThrow('already closed');
    } finally {
      await mock.stop();
      await api.stop();
    }
  });

  it('reports a bot commenter as the sender of the review comment event', async () => {
    const api = await startApi();
    const mock = await startGithubApiMock({
      endpoint: new URL('http://127.0.0.1:0'),
      installationId: INSTALLATION_ID,
      webhookSecret: SECRET,
      apiUrl: api.url,
    });

    try {
      mock.pullRequests.set(1, {repository: 'acme/app', ref: 'feature', sha: 'a'.repeat(40)});
      await mock.sendPullRequestReviewComment({
        pullNumber: 1,
        body: 'Consider a null check.',
        author: 'review-bot[bot]',
        authorType: 'Bot',
      });

      expect(api.deliveries[0]?.payload).toMatchObject({
        comment: {user: {login: 'review-bot[bot]', type: 'Bot'}},
        sender: {login: 'review-bot[bot]', type: 'Bot'},
      });
    } finally {
      await mock.stop();
      await api.stop();
    }
  });

  it('closes a pull request without merging it when merged is not set', async () => {
    const api = await startApi();
    const mock = await startGithubApiMock({
      endpoint: new URL('http://127.0.0.1:0'),
      installationId: INSTALLATION_ID,
      webhookSecret: SECRET,
      apiUrl: api.url,
    });

    try {
      mock.pullRequests.set(4, {repository: 'acme/app', ref: 'feature', sha: 'c'.repeat(40)});
      await mock.sendPullRequestClosed({pullNumber: 4});

      expect(api.deliveries[0]?.payload).toMatchObject({
        action: 'closed',
        pull_request: {number: 4, state: 'closed', merged: false, merged_at: null},
      });
      expect(mock.pullRequests.get(4)).toMatchObject({state: 'closed', merged: false});
      await expect(mock.sendPullRequestClosed({pullNumber: 4})).rejects.toThrow('already closed');
    } finally {
      await mock.stop();
      await api.stop();
    }
  });

  it('labels the fake issue and delivers a signed issues.labeled', async () => {
    const api = await startApi();
    const mock = await startGithubApiMock({
      endpoint: new URL('http://127.0.0.1:0'),
      installationId: INSTALLATION_ID,
      webhookSecret: SECRET,
      apiUrl: api.url,
    });

    try {
      mock.issues.set(5, {
        repository: 'acme/app',
        title: 'Add a --json flag',
        body: 'Print JSON.',
        labels: ['bug'],
      });
      const sent = await mock.sendIssueLabeled({issueNumber: 5, label: 'shipfox'});

      const [delivery] = api.deliveries;
      expect(api.deliveries).toHaveLength(1);
      expect(delivery?.event).toBe('issues');
      expect(delivery?.deliveryId).toBe(sent.deliveryId);
      expect(delivery?.signature).toBe(expectedSignature(delivery?.rawBody ?? ''));
      expect(delivery?.payload).toMatchObject({
        action: 'labeled',
        installation: {id: INSTALLATION_ID},
        repository: {full_name: 'acme/app'},
        sender: {login: 'e2e-maintainer', type: 'User'},
        label: {name: 'shipfox'},
        issue: {
          number: 5,
          state: 'open',
          title: 'Add a --json flag',
          body: 'Print JSON.',
          html_url: 'https://github.com/acme/app/issues/5',
          labels: [{name: 'bug'}, {name: 'shipfox'}],
        },
      });
      expect(delivery?.payload.pull_request).toBeUndefined();
      expect(mock.issues.get(5)?.labels).toEqual(['bug', 'shipfox']);

      await mock.sendIssueLabeled({issueNumber: 5, label: 'shipfox'});
      expect(mock.issues.get(5)?.labels).toEqual(['bug', 'shipfox']);
    } finally {
      await mock.stop();
      await api.stop();
    }
  });

  it('assigns the fake issue and delivers a signed issues.assigned', async () => {
    const api = await startApi();
    const mock = await startGithubApiMock({
      endpoint: new URL('http://127.0.0.1:0'),
      installationId: INSTALLATION_ID,
      webhookSecret: SECRET,
      apiUrl: api.url,
    });

    try {
      mock.issues.set(6, {repository: 'acme/app', title: 'Fix the parser'});
      const sent = await mock.sendIssueAssigned({
        issueNumber: 6,
        assignee: 'shipfox-bot',
        sender: 'lead',
      });

      const [delivery] = api.deliveries;
      expect(api.deliveries).toHaveLength(1);
      expect(delivery?.event).toBe('issues');
      expect(delivery?.deliveryId).toBe(sent.deliveryId);
      expect(delivery?.signature).toBe(expectedSignature(delivery?.rawBody ?? ''));
      expect(delivery?.payload).toMatchObject({
        action: 'assigned',
        sender: {login: 'lead'},
        assignee: {login: 'shipfox-bot'},
        issue: {number: 6, assignees: [{login: 'shipfox-bot'}], assignee: {login: 'shipfox-bot'}},
      });
      expect(mock.issues.get(6)?.assignees).toEqual(['shipfox-bot']);
    } finally {
      await mock.stop();
      await api.stop();
    }
  });

  it('refuses to send an event for an issue the fake does not hold', async () => {
    const mock = await startGithubApiMock({
      endpoint: new URL('http://127.0.0.1:0'),
      installationId: INSTALLATION_ID,
      webhookSecret: SECRET,
    });

    try {
      await expect(mock.sendIssueLabeled({issueNumber: 99, label: 'x'})).rejects.toThrow(
        'no issue #99',
      );
      await expect(mock.sendIssueAssigned({issueNumber: 99, assignee: 'x'})).rejects.toThrow(
        'no issue #99',
      );
    } finally {
      await mock.stop();
    }
  });

  it('refuses to send an event for a pull request the fake does not hold', async () => {
    const mock = await startGithubApiMock({
      endpoint: new URL('http://127.0.0.1:0'),
      installationId: INSTALLATION_ID,
      webhookSecret: SECRET,
    });

    try {
      await expect(mock.sendPullRequestClosed({pullNumber: 99})).rejects.toThrow(
        'no pull request #99',
      );
    } finally {
      await mock.stop();
    }
  });

  it('delivers a signed failed workflow_run.completed on the default branch', async () => {
    const api = await startApi();
    const mock = await startGithubApiMock({
      endpoint: new URL('http://127.0.0.1:0'),
      installationId: INSTALLATION_ID,
      webhookSecret: SECRET,
      apiUrl: api.url,
    });

    try {
      const seedDirectory = await mkdtemp(join(tmpdir(), 'workflow-run-events-'));
      try {
        await writeFile(join(seedDirectory, 'README.md'), '# app\n');
        await mock.addRepository({
          owner: 'acme',
          name: 'app',
          seedDirectory,
          defaultBranch: 'trunk',
        });
      } finally {
        await rm(seedDirectory, {recursive: true, force: true});
      }
      const sent = await mock.sendWorkflowRunCompleted({repository: 'acme/app'});

      const [delivery] = api.deliveries;
      expect(delivery?.event).toBe('workflow_run');
      expect(delivery?.deliveryId).toBe(sent.deliveryId);
      expect(delivery?.signature).toBe(expectedSignature(delivery?.rawBody ?? ''));
      expect(delivery?.payload).toMatchObject({
        action: 'completed',
        installation: {id: INSTALLATION_ID},
        repository: {full_name: 'acme/app', default_branch: 'trunk'},
        workflow_run: {
          conclusion: 'failure',
          status: 'completed',
          head_branch: 'trunk',
          path: '.github/workflows/ci.yml',
          event: 'push',
          run_attempt: 1,
          pull_requests: [],
          head_repository: {full_name: 'acme/app'},
        },
      });
    } finally {
      await mock.stop();
      await api.stop();
    }
  });

  it('describes a pull request run with its actor, head commit, and pull requests', async () => {
    const api = await startApi();
    const mock = await startGithubApiMock({
      endpoint: new URL('http://127.0.0.1:0'),
      installationId: INSTALLATION_ID,
      webhookSecret: SECRET,
      apiUrl: api.url,
    });

    try {
      mock.pullRequests.set(5, {
        repository: 'acme/app',
        ref: 'dependabot/npm_and_yarn/left-pad-2.0.0',
        sha: 'd'.repeat(40),
      });
      await mock.sendWorkflowRunCompleted({
        repository: 'acme/app',
        conclusion: 'success',
        actor: 'dependabot[bot]',
        headCommitMessage: 'Bump left-pad from 1.0.0 to 2.0.0',
        pullNumbers: [5],
        runAttempt: 2,
      });

      expect(api.deliveries[0]?.payload).toMatchObject({
        sender: {login: 'dependabot[bot]'},
        workflow_run: {
          conclusion: 'success',
          head_branch: 'dependabot/npm_and_yarn/left-pad-2.0.0',
          head_sha: 'd'.repeat(40),
          run_attempt: 2,
          event: 'pull_request',
          actor: {login: 'dependabot[bot]'},
          head_commit: {message: 'Bump left-pad from 1.0.0 to 2.0.0'},
          pull_requests: [{number: 5, head: {ref: 'dependabot/npm_and_yarn/left-pad-2.0.0'}}],
        },
      });
    } finally {
      await mock.stop();
      await api.stop();
    }
  });

  it('gives each workflow run its own ID and reports a fork as the head repository', async () => {
    const api = await startApi();
    const mock = await startGithubApiMock({
      endpoint: new URL('http://127.0.0.1:0'),
      installationId: INSTALLATION_ID,
      webhookSecret: SECRET,
      apiUrl: api.url,
    });

    try {
      await mock.sendWorkflowRunCompleted({repository: 'acme/app'});
      await mock.sendWorkflowRunCompleted({
        repository: 'acme/app',
        headRepository: 'contributor/app',
      });

      const [first, second] = api.deliveries.map(
        (delivery) => delivery.payload.workflow_run as {id: number; head_repository: unknown},
      );
      expect(first?.id).not.toBe(second?.id);
      expect(second?.head_repository).toMatchObject({full_name: 'contributor/app'});
    } finally {
      await mock.stop();
      await api.stop();
    }
  });

  it('refuses to send a workflow run for a pull request the fake does not hold', async () => {
    const mock = await startGithubApiMock({
      endpoint: new URL('http://127.0.0.1:0'),
      installationId: INSTALLATION_ID,
      webhookSecret: SECRET,
    });

    try {
      await expect(
        mock.sendWorkflowRunCompleted({repository: 'acme/app', pullNumbers: [99]}),
      ).rejects.toThrow('no pull request #99');
    } finally {
      await mock.stop();
    }
  });
});
