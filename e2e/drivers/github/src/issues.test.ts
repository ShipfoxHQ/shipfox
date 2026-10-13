import {
  GITHUB_READ_RESULT_MARKER,
  GITHUB_STATELESS_INSTALLATION_TOKEN,
  GITHUB_WRITE_RESULT_MARKER,
  startGithubApiMock,
} from './github-api.js';

const HEADERS = {
  authorization: `bearer ${GITHUB_STATELESS_INSTALLATION_TOKEN}`,
  'content-type': 'application/json',
};

async function startMock() {
  const mock = await startGithubApiMock({endpoint: new URL('http://127.0.0.1:0')});
  const request = (method: string, path: string, body?: Record<string, unknown>) =>
    fetch(new URL(path, mock.endpoint), {
      method,
      headers: HEADERS,
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    });
  return {mock, request};
}

describe('GitHub API mock issues', () => {
  it('reads a seeded issue with its labels and assignees', async () => {
    const {mock, request} = await startMock();

    try {
      mock.issues.set(5, {
        repository: 'acme/app',
        title: 'Add a --json flag',
        body: 'Print JSON.',
        labels: ['shipfox', 'bug'],
        assignees: ['octo'],
      });
      const read = await request('GET', '/repos/acme/app/issues/5');
      const labels = await request('GET', '/repos/acme/app/issues/5/labels');

      expect(read.status).toBe(200);
      await expect(read.json()).resolves.toMatchObject({
        number: 5,
        title: 'Add a --json flag',
        body: 'Print JSON.',
        state: 'open',
        html_url: 'https://github.com/acme/app/issues/5',
        labels: [{name: 'shipfox'}, {name: 'bug'}],
        assignees: [{login: 'octo'}],
        assignee: {login: 'octo'},
      });
      await expect(labels.json()).resolves.toMatchObject([{name: 'shipfox'}, {name: 'bug'}]);
      expect(mock.writes()).toEqual([]);
    } finally {
      await mock.stop();
    }
  });

  it('answers a synthetic issue for a number no test seeded', async () => {
    const {mock, request} = await startMock();

    try {
      mock.issues.set(5, {repository: 'acme/app', title: 'Seeded'});
      const unknown = await request('GET', '/repos/acme/app/issues/6');
      const otherRepository = await request('GET', '/repos/acme/other/issues/5');

      await expect(unknown.json()).resolves.toMatchObject({marker: GITHUB_READ_RESULT_MARKER});
      await expect(otherRepository.json()).resolves.toMatchObject({
        marker: GITHUB_READ_RESULT_MARKER,
      });
    } finally {
      await mock.stop();
    }
  });

  it('records issue comments and returns them in posting order', async () => {
    const {mock, request} = await startMock();

    try {
      mock.issues.set(5, {repository: 'acme/app', title: 'Seeded'});
      const first = await request('POST', '/repos/acme/app/issues/5/comments', {body: 'Working.'});
      const second = await request('POST', '/repos/acme/app/issues/5/comments', {body: 'Done.'});
      const empty = await request('POST', '/repos/acme/app/issues/5/comments', {});
      const listed = await request('GET', '/repos/acme/app/issues/5/comments');

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(empty.status).toBe(422);
      await expect(listed.json()).resolves.toMatchObject([
        {id: 1, body: 'Working.', user: {login: 'shipfox-e2e[bot]'}},
        {id: 2, body: 'Done.'},
      ]);
      expect(mock.issues.get(5)?.comments).toHaveLength(2);
      expect(mock.writes()).toEqual([
        {kind: 'github.create_issue_comment', target: 'acme/app#5', payload: {body: 'Working.'}},
        {kind: 'github.create_issue_comment', target: 'acme/app#5', payload: {body: 'Done.'}},
      ]);
    } finally {
      await mock.stop();
    }
  });

  it('adds and removes labels, recording each request', async () => {
    const {mock, request} = await startMock();

    try {
      mock.issues.set(5, {repository: 'acme/app', title: 'Seeded', labels: ['shipfox']});
      const added = await request('POST', '/repos/acme/app/issues/5/labels', {
        labels: ['in-progress', 'shipfox'],
      });
      const removed = await request('DELETE', '/repos/acme/app/issues/5/labels/shipfox');
      const missing = await request('DELETE', '/repos/acme/app/issues/5/labels/shipfox');
      const invalid = await request('POST', '/repos/acme/app/issues/5/labels', {labels: 'x'});

      await expect(added.json()).resolves.toMatchObject([{name: 'shipfox'}, {name: 'in-progress'}]);
      await expect(removed.json()).resolves.toMatchObject([{name: 'in-progress'}]);
      expect(missing.status).toBe(404);
      expect(invalid.status).toBe(422);
      expect(mock.issues.get(5)?.labels).toEqual(['in-progress']);
      expect(mock.writes()).toEqual([
        {
          kind: 'github.add_labels',
          target: 'acme/app#5',
          payload: {labels: ['in-progress', 'shipfox']},
        },
        {kind: 'github.remove_label', target: 'acme/app#5', payload: {name: 'shipfox'}},
      ]);
    } finally {
      await mock.stop();
    }
  });

  it('replaces the label set when an issue update carries labels', async () => {
    const {mock, request} = await startMock();

    try {
      mock.issues.set(5, {repository: 'acme/app', title: 'Seeded', labels: ['shipfox']});
      const updated = await request('PATCH', '/repos/acme/app/issues/5', {
        labels: ['shipfox', 'in-progress'],
        state: 'closed',
      });
      const invalid = await request('PATCH', '/repos/acme/app/issues/5', {labels: [1]});
      const unknown = await request('PATCH', '/repos/acme/app/issues/9', {title: 'Nope'});

      await expect(updated.json()).resolves.toMatchObject({
        state: 'closed',
        labels: [{name: 'shipfox'}, {name: 'in-progress'}],
      });
      expect(invalid.status).toBe(422);
      expect(unknown.status).toBe(404);
      expect(mock.writes()).toEqual([
        {
          kind: 'github.update_issue',
          target: 'acme/app#5',
          payload: {labels: ['shipfox', 'in-progress'], state: 'closed'},
        },
      ]);
    } finally {
      await mock.stop();
    }
  });

  it('keeps issue numbers out of the numbers new pull requests take', async () => {
    const {mock, request} = await startMock();

    try {
      mock.issues.set(4, {repository: 'acme/app', title: 'Seeded'});
      const created = await request('POST', '/repos/acme/app/pulls', {
        title: 'Fix',
        head: 'feature',
        base: 'main',
      });

      await expect(created.json()).resolves.toMatchObject({number: 5});
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
      mock.issues.set(5, {repository: 'acme/app', title: 'Seeded'});
      await fetch(new URL('/repos/acme/app/issues/5/labels', mock.endpoint), {
        method: 'POST',
        headers: {...HEADERS, authorization: 'bearer stale'},
        body: JSON.stringify({labels: ['late']}),
      });

      expect(mock.writes()).toEqual([]);
    } finally {
      await mock.stop();
    }
  });

  it('lists the open issues of a repository with its pull requests, newest first', async () => {
    const {mock, request} = await startMock();

    try {
      mock.issues.set(1, {repository: 'acme/app', title: 'Open', labels: ['bug']});
      mock.issues.set(2, {repository: 'acme/app', title: 'Closed', state: 'closed'});
      mock.issues.set(3, {repository: 'acme/other', title: 'Elsewhere'});
      mock.pullRequests.set(4, {
        repository: 'acme/app',
        ref: 'feature',
        sha: 'a'.repeat(40),
        title: 'A pull request',
      });
      const open = await request('GET', '/repos/acme/app/issues');
      const all = await request('GET', '/repos/acme/app/issues?state=all&per_page=2');
      const labelled = await request('GET', '/repos/acme/app/issues?labels=bug');

      await expect(open.json()).resolves.toMatchObject([
        {number: 4, title: 'A pull request', pull_request: {}},
        {number: 1, title: 'Open', state: 'open'},
      ]);
      await expect(all.json()).resolves.toMatchObject([{number: 4}, {number: 2, state: 'closed'}]);
      await expect(labelled.json()).resolves.toMatchObject([{number: 1}]);
    } finally {
      await mock.stop();
    }
  });

  it('lists the issue types an organization starts with', async () => {
    const {mock, request} = await startMock();

    try {
      const response = await request('GET', '/repos/acme/app/issue-types');

      await expect(response.json()).resolves.toMatchObject([
        {name: 'Task'},
        {name: 'Bug'},
        {name: 'Feature'},
      ]);
    } finally {
      await mock.stop();
    }
  });

  it('pages the comments of an issue and lists the comments of a pull request', async () => {
    const {mock, request} = await startMock();

    try {
      mock.issues.set(1, {
        repository: 'acme/app',
        title: 'Open',
        comments: [1, 2, 3].map((id) => ({id, body: `Comment ${id}`, author: 'octo'})),
      });
      mock.pullRequests.set(2, {
        repository: 'acme/app',
        ref: 'feature',
        sha: 'a'.repeat(40),
        comments: [{id: 9, body: 'A plain pull request comment.', author: 'octo'}],
      });
      const page = await request('GET', '/repos/acme/app/issues/1/comments?per_page=2&page=2');
      const pullRequest = await request('GET', '/repos/acme/app/issues/2/comments');
      mock.pullRequests.set(4, {repository: 'acme/app', ref: 'quiet', sha: 'c'.repeat(40)});
      const missing = await request('GET', '/repos/acme/app/issues/3/comments');
      const quiet = await request('GET', '/repos/acme/app/issues/4/comments');

      await expect(page.json()).resolves.toMatchObject([
        {id: 3, body: 'Comment 3', user: {login: 'octo'}},
      ]);
      await expect(pullRequest.json()).resolves.toMatchObject([
        {id: 9, body: 'A plain pull request comment.'},
      ]);
      expect(missing.status).toBe(404);
      await expect(quiet.json()).resolves.toEqual([]);
    } finally {
      await mock.stop();
    }
  });

  it('lists the sub-issues of an issue and reads the parent of a sub-issue', async () => {
    const {mock, request} = await startMock();

    try {
      mock.issues.set(3, {repository: 'acme/app', title: 'Parent'});
      mock.issues.set(4, {repository: 'acme/app', title: 'Child', parent: 3});
      mock.issues.set(5, {repository: 'acme/other', title: 'Elsewhere', parent: 3});
      const subIssues = await request('GET', '/repos/acme/app/issues/3/sub_issues');
      const noSubIssues = await request('GET', '/repos/acme/app/issues/4/sub_issues');
      const parent = await request('GET', '/repos/acme/app/issues/4/parent');
      const noParent = await request('GET', '/repos/acme/app/issues/3/parent');

      await expect(subIssues.json()).resolves.toMatchObject([{number: 4, title: 'Child'}]);
      await expect(noSubIssues.json()).resolves.toEqual([]);
      await expect(parent.json()).resolves.toMatchObject({number: 3, title: 'Parent'});
      expect(noParent.status).toBe(404);
    } finally {
      await mock.stop();
    }
  });

  it('creates an issue that reads back, and numbers it past the pull requests', async () => {
    const {mock, request} = await startMock();

    try {
      mock.pullRequests.set(3, {repository: 'acme/app', ref: 'feature', sha: 'a'.repeat(40)});
      const created = await request('POST', '/repos/acme/app/issues', {
        title: 'Contract issue',
        body: 'Created by a contract.',
        labels: ['bug'],
      });
      const rejected = await request('POST', '/repos/acme/app/issues', {body: 'No title'});
      const read = await request('GET', '/repos/acme/app/issues/4');

      expect(created.status).toBe(201);
      await expect(created.json()).resolves.toMatchObject({
        number: 4,
        title: 'Contract issue',
        state: 'open',
        labels: [{name: 'bug'}],
        user: {login: 'shipfox-e2e[bot]'},
        marker: GITHUB_WRITE_RESULT_MARKER,
      });
      expect(rejected.status).toBe(422);
      await expect(read.json()).resolves.toMatchObject({number: 4, body: 'Created by a contract.'});
      expect(mock.writes()).toEqual([
        {
          kind: 'github.create_issue',
          target: 'acme/app#4',
          payload: {title: 'Contract issue', body: 'Created by a contract.', labels: ['bug']},
        },
      ]);
    } finally {
      await mock.stop();
    }
  });

  it('keeps comment ids unique past the ids of the seeded comments', async () => {
    const {mock, request} = await startMock();

    try {
      mock.issues.set(1, {
        repository: 'acme/app',
        title: 'Seeded',
        comments: [
          {id: 1, body: 'one', author: 'a'},
          {id: 32, body: 'thirty-two', author: 'a'},
        ],
      });
      const first = await request('POST', '/repos/acme/app/issues/1/comments', {body: 'new'});
      const second = await request('POST', '/repos/acme/app/issues/1/comments', {body: 'newer'});

      await expect(first.json()).resolves.toMatchObject({id: 33});
      await expect(second.json()).resolves.toMatchObject({id: 34});
    } finally {
      await mock.stop();
    }
  });

  it('reports why a closed issue closed', async () => {
    const {mock, request} = await startMock();

    try {
      mock.issues.set(1, {repository: 'acme/app', title: 'Seeded'});
      const closed = await request('PATCH', '/repos/acme/app/issues/1', {
        state: 'closed',
        state_reason: 'not_planned',
      });
      const defaulted = await request('PATCH', '/repos/acme/app/issues/1', {state: 'closed'});
      const reopened = await request('PATCH', '/repos/acme/app/issues/1', {state: 'open'});

      await expect(closed.json()).resolves.toMatchObject({state_reason: 'not_planned'});
      await expect(defaulted.json()).resolves.toMatchObject({state_reason: 'completed'});
      await expect(reopened.json()).resolves.toMatchObject({state: 'open', state_reason: null});
    } finally {
      await mock.stop();
    }
  });

  it('adds, orders, and removes sub-issues', async () => {
    const {mock, request} = await startMock();
    const ids = async (number: number) => {
      const response = await request('GET', `/repos/acme/app/issues/${number}/sub_issues`);
      return ((await response.json()) as Array<{number: number}>).map((issue) => issue.number);
    };

    try {
      for (const number of [1, 2, 3]) {
        mock.issues.set(number, {repository: 'acme/app', title: `Issue ${number}`});
      }
      const add = (subIssue: number) =>
        request('POST', '/repos/acme/app/issues/1/sub_issues', {
          sub_issue_id: 1_000_000 + subIssue,
        });

      const first = await add(3);
      await add(2);
      const duplicate = await add(2);
      const order = await ids(1);
      const reprioritized = await request('PATCH', '/repos/acme/app/issues/1/sub_issues/priority', {
        sub_issue_id: 1_000_002,
        before_id: 1_000_003,
      });
      const reordered = await ids(1);
      const removed = await request('DELETE', '/repos/acme/app/issues/1/sub_issue', {
        sub_issue_id: 1_000_002,
      });
      const parent = await request('GET', '/repos/acme/app/issues/2/parent');
      const unknown = await add(9);

      expect(first.status).toBe(201);
      await expect(first.json()).resolves.toMatchObject({number: 1});
      expect(duplicate.status).toBe(422);
      expect(order).toEqual([3, 2]);
      expect(reprioritized.status).toBe(200);
      expect(reordered).toEqual([2, 3]);
      expect(removed.status).toBe(200);
      expect(await ids(1)).toEqual([3]);
      expect(parent.status).toBe(404);
      expect(unknown.status).toBe(404);
      expect(mock.writes().map((write) => write.kind)).toEqual([
        'github.add_sub_issue',
        'github.add_sub_issue',
        'github.reprioritize_sub_issue',
        'github.remove_sub_issue',
      ]);
    } finally {
      await mock.stop();
    }
  });
});
