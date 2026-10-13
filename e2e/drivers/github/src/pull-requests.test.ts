import {GITHUB_STATELESS_INSTALLATION_TOKEN, startGithubApiMock} from './github-api.js';

const ROOT = 'a'.repeat(40);
const HEAD_TIP = 'b'.repeat(40);
const BASE_TIP = 'c'.repeat(40);

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

  it('reads the author of a seeded pull request', async () => {
    const mock = await startGithubApiMock({endpoint: new URL('http://127.0.0.1:0')});
    mock.pullRequests.set(1, {
      repository: 'acme/app',
      ref: 'dependabot/npm_and_yarn/left-pad-1.1.0',
      sha: 'b'.repeat(40),
      author: 'dependabot[bot]',
    });
    mock.pullRequests.set(2, {repository: 'acme/app', ref: 'feature', sha: 'c'.repeat(40)});

    try {
      const read = (number: number) =>
        fetch(new URL(`/repos/acme/app/pulls/${number}`, mock.endpoint), {headers: HEADERS});

      await expect((await read(1)).json()).resolves.toMatchObject({
        user: {login: 'dependabot[bot]'},
      });
      await expect((await read(2)).json()).resolves.toMatchObject({user: {login: 'e2e-author'}});
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

  it('answers the files, commits, reviews, comments, and diff of a seeded pull request', async () => {
    const mock = await startGithubApiMock({endpoint: new URL('http://127.0.0.1:0')});
    const get = (path: string, headers: Record<string, string> = {}) =>
      fetch(new URL(path, mock.endpoint), {headers: {...HEADERS, ...headers}});

    try {
      mock.commits.set('b'.repeat(40), {repository: 'acme/app', message: 'Extend the notes'});
      mock.pullRequests.set(7, {
        repository: 'acme/app',
        ref: 'feature',
        sha: 'b'.repeat(40),
        commits: ['b'.repeat(40)],
        files: [
          {filename: 'notes.md', status: 'modified', patch: '@@ -1 +1,2 @@\n one\n+two'},
          {filename: 'extra.txt', status: 'added', patch: '@@ -0,0 +1 @@\n+extra'},
        ],
        reviews: [{id: 11, body: 'Review with threads.', author: 'octo'}],
      });
      mock.reviewThreads.set('PRRT_1', {
        pullNumber: 7,
        path: 'notes.md',
        comments: [
          {id: 21, body: 'Why two?', author: 'octo'},
          {id: 22, body: 'Because.', author: 'e2e-author'},
        ],
      });
      const files = await get('/repos/acme/app/pulls/7/files');
      const commits = await get('/repos/acme/app/pulls/7/commits');
      const reviews = await get('/repos/acme/app/pulls/7/reviews');
      const comments = await get('/repos/acme/app/pulls/7/comments');
      const diff = await get('/repos/acme/app/pulls/7', {
        accept: 'application/vnd.github.diff',
      });
      const missing = await get('/repos/acme/app/pulls/8/files');

      await expect(files.json()).resolves.toMatchObject([
        {filename: 'notes.md', status: 'modified', additions: 1, deletions: 0, changes: 1},
        {filename: 'extra.txt', status: 'added', additions: 1},
      ]);
      await expect(commits.json()).resolves.toMatchObject([
        {sha: 'b'.repeat(40), commit: {message: 'Extend the notes'}},
      ]);
      await expect(reviews.json()).resolves.toMatchObject([
        {id: 11, state: 'COMMENTED', body: 'Review with threads.', user: {login: 'octo'}},
      ]);
      await expect(comments.json()).resolves.toMatchObject([
        {id: 21, path: 'notes.md', body: 'Why two?'},
        {id: 22, body: 'Because.', in_reply_to_id: 21},
      ]);
      expect(diff.headers.get('content-type')).toContain('diff');
      const text = await diff.text();
      expect(text).toContain('diff --git a/notes.md b/notes.md\n--- a/notes.md\n+++ b/notes.md\n');
      expect(text).toContain('diff --git a/extra.txt b/extra.txt\nnew file mode 100644\n');
      expect(missing.status).toBe(404);
    } finally {
      await mock.stop();
    }
  });

  it('puts a head branch behind its base back in line with a merge commit', async () => {
    const mock = await startGithubApiMock({endpoint: new URL('http://127.0.0.1:0')});
    const request = (method: string, path: string, body?: Record<string, unknown>) =>
      fetch(new URL(path, mock.endpoint), {
        method,
        headers: HEADERS,
        ...(body === undefined ? {} : {body: JSON.stringify(body)}),
      });

    try {
      mock.commits.set(ROOT, {repository: 'acme/app', message: 'Root'});
      mock.commits.set(HEAD_TIP, {repository: 'acme/app', message: 'Head', parents: [ROOT]});
      mock.commits.set(BASE_TIP, {repository: 'acme/app', message: 'Base', parents: [ROOT]});
      mock.branchHeads.set('feature', HEAD_TIP);
      mock.branchHeads.set('base', BASE_TIP);
      await request('POST', '/repos/acme/app/pulls', {
        title: 'Change',
        head: 'feature',
        base: 'base',
      });
      const stale = await request('PUT', '/repos/acme/app/pulls/1/update-branch', {
        expected_head_sha: BASE_TIP,
      });
      const before = await request('GET', '/repos/acme/app/compare/base...feature');
      const updated = await request('PUT', '/repos/acme/app/pulls/1/update-branch', {
        expected_head_sha: HEAD_TIP,
      });
      const after = await request('GET', '/repos/acme/app/compare/base...feature');
      const again = await request('PUT', '/repos/acme/app/pulls/1/update-branch', {});
      const pull = await request('GET', '/repos/acme/app/pulls/1');

      expect(stale.status).toBe(422);
      await expect(before.json()).resolves.toMatchObject({
        status: 'diverged',
        ahead_by: 1,
        behind_by: 1,
      });
      expect(updated.status).toBe(202);
      await expect(after.json()).resolves.toMatchObject({
        status: 'ahead',
        ahead_by: 2,
        behind_by: 0,
      });
      expect(again.status).toBe(422);
      await expect(pull.json()).resolves.toMatchObject({
        head: {sha: mock.branchHeads.get('feature')},
      });
      expect(mock.writes().map((write) => write.kind)).toEqual([
        'github.create_pull_request',
        'github.update_pull_request_branch',
      ]);
    } finally {
      await mock.stop();
    }
  });

  it('merges into the base branch with a commit that becomes its tip', async () => {
    const mock = await startGithubApiMock({endpoint: new URL('http://127.0.0.1:0')});
    const request = (method: string, path: string, body?: Record<string, unknown>) =>
      fetch(new URL(path, mock.endpoint), {
        method,
        headers: HEADERS,
        ...(body === undefined ? {} : {body: JSON.stringify(body)}),
      });

    try {
      mock.commits.set(ROOT, {repository: 'acme/app', message: 'Root'});
      mock.commits.set(HEAD_TIP, {repository: 'acme/app', message: 'Head', parents: [ROOT]});
      mock.branchHeads.set('feature', HEAD_TIP);
      mock.branchHeads.set('base', ROOT);
      await request('POST', '/repos/acme/app/pulls', {
        title: 'Change',
        head: 'feature',
        base: 'base',
      });
      const merged = await request('PUT', '/repos/acme/app/pulls/1/merge', {
        merge_method: 'merge',
        commit_title: 'Contract merge',
      });
      const {sha} = (await merged.json()) as {sha: string};
      const commit = await request('GET', `/repos/acme/app/commits/${sha}`);

      expect(mock.branchHeads.get('base')).toBe(sha);
      await expect(commit.json()).resolves.toMatchObject({
        commit: {message: 'Contract merge'},
        parents: [{sha: ROOT}, {sha: HEAD_TIP}],
      });
    } finally {
      await mock.stop();
    }
  });

  it('drafts a review with a thread, discards it, and submits another', async () => {
    const mock = await startGithubApiMock({endpoint: new URL('http://127.0.0.1:0')});
    const request = (method: string, path: string, body?: Record<string, unknown>) =>
      fetch(new URL(path, mock.endpoint), {
        method,
        headers: HEADERS,
        ...(body === undefined ? {} : {body: JSON.stringify(body)}),
      });
    const graphql = (query: string, variables: Record<string, unknown>) =>
      request('POST', '/graphql', {query, variables});

    try {
      mock.pullRequests.set(1, {repository: 'acme/app', ref: 'feature', sha: HEAD_TIP});
      const draft = await request('POST', '/repos/acme/app/pulls/1/reviews', {
        commit_id: HEAD_TIP,
        body: 'Draft',
      });
      const second = await request('POST', '/repos/acme/app/pulls/1/reviews', {body: 'Another'});
      const {id: draftId, node_id: draftNode} = (await draft.json()) as {
        id: number;
        node_id: string;
      };
      const thread = await graphql('mutation { addPullRequestReviewThread(input: $input) }', {
        input: {
          pullRequestReviewId: draftNode,
          path: 'note.md',
          body: 'Thread',
          line: 1,
          side: 'RIGHT',
        },
      });
      const discarded = await request('DELETE', `/repos/acme/app/pulls/1/reviews/${draftId}`);
      const afterDiscard = await graphql('query { reviewThreads }', {
        owner: 'acme',
        repo: 'app',
        pullNumber: 1,
      });
      const missing = await graphql('mutation { addPullRequestReviewThread(input: $input) }', {
        input: {pullRequestReviewId: draftNode, path: 'note.md', body: 'Thread'},
      });

      expect(draft.status).toBe(200);
      expect(second.status).toBe(422);
      await expect(thread.json()).resolves.toMatchObject({
        data: {addPullRequestReviewThread: {thread: {id: expect.any(String)}}},
      });
      await expect(discarded.json()).resolves.toMatchObject({id: draftId, state: 'PENDING'});
      await expect(afterDiscard.json()).resolves.toMatchObject({
        data: {repository: {pullRequest: {reviewThreads: {nodes: []}}}},
      });
      await expect(missing.json()).resolves.toMatchObject({
        data: {addPullRequestReviewThread: null},
        errors: [{type: 'NOT_FOUND'}],
      });

      const review = await request('POST', '/repos/acme/app/pulls/1/reviews', {body: 'Draft'});
      const {id, node_id: nodeId} = (await review.json()) as {id: number; node_id: string};
      await graphql('mutation { addPullRequestReviewThread(input: $input) }', {
        input: {pullRequestReviewId: nodeId, path: 'note.md', body: 'Thread', line: 3},
      });
      const submitted = await request('POST', `/repos/acme/app/pulls/1/reviews/${id}/events`, {
        event: 'COMMENT',
        body: 'Done',
      });
      const resubmitted = await request('POST', `/repos/acme/app/pulls/1/reviews/${id}/events`, {
        event: 'COMMENT',
      });
      const reviews = await request('GET', '/repos/acme/app/pulls/1/reviews');
      const comments = await request('GET', '/repos/acme/app/pulls/1/comments');

      await expect(submitted.json()).resolves.toMatchObject({state: 'COMMENTED', body: 'Done'});
      expect(resubmitted.status).toBe(422);
      await expect(reviews.json()).resolves.toMatchObject([
        {id, state: 'COMMENTED', body: 'Done', user: {login: 'shipfox-e2e[bot]'}},
      ]);
      await expect(comments.json()).resolves.toMatchObject([
        {body: 'Thread', pull_request_review_id: id},
      ]);
    } finally {
      await mock.stop();
    }
  });

  it('rejects a review event that is no event, and keeps the line of a thread comment', async () => {
    const mock = await startGithubApiMock({endpoint: new URL('http://127.0.0.1:0')});
    const request = (method: string, path: string, body?: Record<string, unknown>) =>
      fetch(new URL(path, mock.endpoint), {
        method,
        headers: HEADERS,
        ...(body === undefined ? {} : {body: JSON.stringify(body)}),
      });

    try {
      mock.pullRequests.set(1, {repository: 'acme/app', ref: 'feature', sha: HEAD_TIP});
      const inherited = await request('POST', '/repos/acme/app/pulls/1/reviews', {
        event: 'toString',
      });
      const draft = await request('POST', '/repos/acme/app/pulls/1/reviews', {body: 'Draft'});
      const {node_id: nodeId} = (await draft.json()) as {node_id: string};
      await request('POST', '/graphql', {
        query: 'mutation { addPullRequestReviewThread(input: $input) }',
        variables: {input: {pullRequestReviewId: nodeId, path: 'note.md', body: 'Thread', line: 3}},
      });
      const threads = await request('POST', '/graphql', {
        query: 'query { reviewThreads }',
        variables: {owner: 'acme', repo: 'app', pullNumber: 1},
      });

      expect(inherited.status).toBe(422);
      await expect(threads.json()).resolves.toMatchObject({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {nodes: [{line: 3, comments: {nodes: [{line: 3}]}}]},
            },
          },
        },
      });
    } finally {
      await mock.stop();
    }
  });
});
