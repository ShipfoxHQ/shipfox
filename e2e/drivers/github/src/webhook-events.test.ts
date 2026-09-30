import {createHmac} from 'node:crypto';
import {createServer, type IncomingMessage} from 'node:http';
import type {AddressInfo} from 'node:net';
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
});
