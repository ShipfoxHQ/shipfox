import {
  GITHUB_READ_RESULT_MARKER,
  GITHUB_STATELESS_INSTALLATION_TOKEN,
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
});
