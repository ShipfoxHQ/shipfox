import {GITHUB_STATELESS_INSTALLATION_TOKEN, startGithubApiMock} from './github-api.js';

const HEADERS = {
  authorization: `bearer ${GITHUB_STATELESS_INSTALLATION_TOKEN}`,
  'content-type': 'application/json',
};

describe('GitHub API mock pull requests', () => {
  it('creates, lists by head, reads, updates, and merges a pull request', async () => {
    const mock = await startGithubApiMock({endpoint: new URL('http://127.0.0.1:0')});
    const request = (method: string, path: string, body?: Record<string, unknown>) =>
      fetch(new URL(path, mock.endpoint), {
        method,
        headers: HEADERS,
        ...(body === undefined ? {} : {body: JSON.stringify(body)}),
      });

    try {
      mock.branchHeads.set('feature', 'a'.repeat(40));
      const created = await request('POST', '/repos/acme/app/pulls', {
        title: 'Add a flag',
        head: 'feature',
        base: 'main',
        draft: true,
      });
      const byHead = await request('GET', '/repos/acme/app/pulls?head=acme:feature');
      const otherHead = await request('GET', '/repos/acme/app/pulls?head=acme:other');
      const read = await request('GET', '/repos/acme/app/pulls/1');
      const notMergeable = await request('PUT', '/repos/acme/app/pulls/1/merge', {});
      const updated = await request('PATCH', '/repos/acme/app/pulls/1', {
        title: 'Add a --json flag',
      });
      const closed = await request('PATCH', '/repos/acme/app/pulls/1', {state: 'closed'});
      const open = await request('GET', '/repos/acme/app/pulls');
      const all = await request('GET', '/repos/acme/app/pulls?state=all');

      expect(created.status).toBe(201);
      await expect(created.json()).resolves.toMatchObject({
        number: 1,
        state: 'open',
        draft: true,
        head: {ref: 'feature', sha: 'a'.repeat(40)},
        base: {ref: 'main'},
      });
      await expect(byHead.json()).resolves.toMatchObject([{number: 1}]);
      await expect(otherHead.json()).resolves.toEqual([]);
      await expect(read.json()).resolves.toMatchObject({number: 1, title: 'Add a flag'});
      expect(notMergeable.status).toBe(405);
      await expect(updated.json()).resolves.toMatchObject({title: 'Add a --json flag'});
      await expect(closed.json()).resolves.toMatchObject({state: 'closed', merged: false});
      await expect(open.json()).resolves.toEqual([]);
      await expect(all.json()).resolves.toMatchObject([{number: 1}]);
      expect(mock.writes()).toEqual([
        {
          kind: 'github.create_pull_request',
          target: 'acme/app#1',
          payload: {title: 'Add a flag', head: 'feature', base: 'main', draft: true},
        },
        {
          kind: 'github.update_pull_request',
          target: 'acme/app#1',
          payload: {title: 'Add a --json flag'},
        },
        {kind: 'github.update_pull_request', target: 'acme/app#1', payload: {state: 'closed'}},
      ]);
    } finally {
      await mock.stop();
    }
  });

  it('merges a ready pull request and refuses to reopen it', async () => {
    const mock = await startGithubApiMock({endpoint: new URL('http://127.0.0.1:0')});
    const request = (method: string, path: string, body: Record<string, unknown>) =>
      fetch(new URL(path, mock.endpoint), {method, headers: HEADERS, body: JSON.stringify(body)});

    try {
      mock.pullRequests.set(4, {repository: 'acme/app', ref: 'feature', sha: 'b'.repeat(40)});
      const merged = await request('PUT', '/repos/acme/app/pulls/4/merge', {
        merge_method: 'squash',
      });
      const reopened = await request('PATCH', '/repos/acme/app/pulls/4', {state: 'open'});

      await expect(merged.json()).resolves.toMatchObject({merged: true});
      expect(reopened.status).toBe(422);
      expect(mock.pullRequests.get(4)).toMatchObject({merged: true, state: 'closed'});
      expect(mock.writes()).toEqual([
        {
          kind: 'github.merge_pull_request',
          target: 'acme/app#4',
          payload: {merge_method: 'squash'},
        },
      ]);
    } finally {
      await mock.stop();
    }
  });

  it('rejects invalid pull request writes without recording them', async () => {
    const mock = await startGithubApiMock({endpoint: new URL('http://127.0.0.1:0')});
    const create = (body: Record<string, unknown>) =>
      fetch(new URL('/repos/acme/app/pulls', mock.endpoint), {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify(body),
      });

    try {
      const first = await create({title: 'One', head: 'feature', base: 'main'});
      const duplicate = await create({title: 'Two', head: 'feature', base: 'main'});
      const missing = await create({title: 'Three'});
      const unknown = await fetch(new URL('/repos/acme/app/pulls/9', mock.endpoint), {
        method: 'PATCH',
        headers: HEADERS,
        body: JSON.stringify({title: 'Nope'}),
      });
      const otherRepository = await fetch(new URL('/repos/acme/other/pulls/1', mock.endpoint), {
        headers: HEADERS,
      });

      expect(first.status).toBe(201);
      expect(duplicate.status).toBe(422);
      expect(missing.status).toBe(422);
      expect(unknown.status).toBe(404);
      expect(otherRepository.status).toBe(404);
      expect(mock.writes().map((write) => write.kind)).toEqual(['github.create_pull_request']);
    } finally {
      await mock.stop();
    }
  });

  it('records a reply to a review comment and a thread resolution', async () => {
    const mock = await startGithubApiMock({endpoint: new URL('http://127.0.0.1:0')});
    const post = (path: string, body: Record<string, unknown>) =>
      fetch(new URL(path, mock.endpoint), {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify(body),
      });
    const threads = async () => {
      const response = await post('/graphql', {
        query: 'query GetPullRequestReviewThreads { reviewThreads { nodes { id } } }',
        variables: {owner: 'acme', repo: 'app', pullNumber: 3},
      });
      const json = (await response.json()) as {
        data: {repository: {pullRequest: {reviewThreads: {nodes: Record<string, unknown>[]}}}};
      };
      return json.data.repository.pullRequest.reviewThreads.nodes;
    };

    try {
      mock.pullRequests.set(3, {repository: 'acme/app', ref: 'feature', sha: 'c'.repeat(40)});
      mock.reviewThreads.set('PRRT_1', {
        pullNumber: 3,
        path: 'src/report.ts',
        comments: [{id: 11, body: 'Rename the flag.', author: 'reviewer'}],
      });
      const before = await threads();
      const reply = await post('/repos/acme/app/pulls/3/comments/11/replies', {body: 'Renamed.'});
      const unknownComment = await post('/repos/acme/app/pulls/3/comments/99/replies', {body: 'x'});
      const resolve = await post('/graphql', {
        query: 'mutation ResolvePullRequestReviewThread { resolveReviewThread { thread { id } } }',
        variables: {input: {threadId: 'PRRT_1'}},
      });
      const after = await threads();

      expect(reply.status).toBe(201);
      await expect(reply.json()).resolves.toMatchObject({in_reply_to_id: 11, body: 'Renamed.'});
      expect(unknownComment.status).toBe(404);
      await expect(resolve.json()).resolves.toMatchObject({
        data: {resolveReviewThread: {thread: {id: 'PRRT_1', isResolved: true}}},
      });
      expect(before).toMatchObject([{id: 'PRRT_1', isResolved: false}]);
      expect(after).toMatchObject([
        {
          id: 'PRRT_1',
          isResolved: true,
          comments: {nodes: [{databaseId: 11}, {databaseId: 12, body: 'Renamed.'}]},
        },
      ]);
      expect(mock.writes()).toEqual([
        {
          kind: 'github.reply_to_review_comment',
          target: 'acme/app#3',
          payload: {comment_id: 11, body: 'Renamed.'},
        },
        {
          kind: 'github.resolve_review_thread',
          target: 'acme/app#3',
          payload: {thread_id: 'PRRT_1'},
        },
      ]);
    } finally {
      await mock.stop();
    }
  });

  it('records issue comments on a pull request', async () => {
    const mock = await startGithubApiMock({endpoint: new URL('http://127.0.0.1:0')});
    const comment = (body: Record<string, unknown>) =>
      fetch(new URL('/repos/acme/app/issues/3/comments', mock.endpoint), {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify(body),
      });

    try {
      const created = await comment({body: 'Ready for review.'});
      const empty = await comment({});

      expect(created.status).toBe(201);
      await expect(created.json()).resolves.toMatchObject({id: 1, body: 'Ready for review.'});
      expect(empty.status).toBe(422);
      expect(mock.writes()).toEqual([
        {
          kind: 'github.create_issue_comment',
          target: 'acme/app#3',
          payload: {body: 'Ready for review.'},
        },
      ]);
    } finally {
      await mock.stop();
    }
  });

  it('rejects the resolution of an unknown thread without recording it', async () => {
    const mock = await startGithubApiMock({endpoint: new URL('http://127.0.0.1:0')});

    try {
      const response = await fetch(new URL('/graphql', mock.endpoint), {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({
          query:
            'mutation ResolvePullRequestReviewThread { resolveReviewThread { thread { id } } }',
          variables: {input: {threadId: 'PRRT_unknown'}},
        }),
      });

      await expect(response.json()).resolves.toMatchObject({
        data: {resolveReviewThread: null},
        errors: [{type: 'NOT_FOUND'}],
      });
      expect(mock.writes()).toEqual([]);
    } finally {
      await mock.stop();
    }
  });

  it('stores the branch of an owner-qualified head', async () => {
    const mock = await startGithubApiMock({endpoint: new URL('http://127.0.0.1:0')});

    try {
      const created = await fetch(new URL('/repos/acme/app/pulls', mock.endpoint), {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({title: 'One', head: 'acme:feature', base: 'main'}),
      });
      const byHead = await fetch(
        new URL('/repos/acme/app/pulls?head=acme:feature', mock.endpoint),
        {
          headers: HEADERS,
        },
      );

      await expect(created.json()).resolves.toMatchObject({head: {ref: 'feature'}});
      await expect(byHead.json()).resolves.toMatchObject([{number: 1}]);
    } finally {
      await mock.stop();
    }
  });

  it('does not record writes made with a stale installation token', async () => {
    const mock = await startGithubApiMock({
      endpoint: new URL('http://127.0.0.1:0'),
      installationId: 1234,
    });

    try {
      await fetch(new URL('/repos/acme/app/issues/3/comments', mock.endpoint), {
        method: 'POST',
        headers: {...HEADERS, authorization: 'bearer stale'},
        body: JSON.stringify({body: 'Late.'}),
      });

      expect(mock.writes()).toEqual([]);
    } finally {
      await mock.stop();
    }
  });
});
