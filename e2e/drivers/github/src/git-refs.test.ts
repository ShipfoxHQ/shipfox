import {GITHUB_STATELESS_INSTALLATION_TOKEN, startGithubApiMock} from './github-api.js';

const BASE = 'a'.repeat(40);
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
  mock.commits.set(BASE, {repository: 'acme/app', message: 'Seed the notes'});
  return {mock, request};
}

describe('GitHub API mock branches', () => {
  it('creates, reads, and deletes a branch, and records each write', async () => {
    const {mock, request} = await startMock();

    try {
      const created = await request('POST', '/repos/acme/app/git/refs', {
        ref: 'refs/heads/contract/one',
        sha: BASE,
      });
      const again = await request('POST', '/repos/acme/app/git/refs', {
        ref: 'refs/heads/contract/one',
        sha: BASE,
      });
      const ref = await request('GET', '/repos/acme/app/git/ref/heads/contract%2Fone');
      const branch = await request('GET', '/repos/acme/app/branches/contract%2Fone');
      const deleted = await request('DELETE', '/repos/acme/app/git/refs/heads/contract%2Fone');
      const gone = await request('GET', '/repos/acme/app/git/ref/heads/contract%2Fone');
      const deletedAgain = await request('DELETE', '/repos/acme/app/git/refs/heads/contract%2Fone');

      expect(created.status).toBe(201);
      await expect(created.json()).resolves.toMatchObject({
        ref: 'refs/heads/contract/one',
        object: {sha: BASE, type: 'commit'},
        url: expect.any(String),
      });
      expect(again.status).toBe(422);
      await expect(ref.json()).resolves.toMatchObject({object: {sha: BASE}});
      await expect(branch.json()).resolves.toMatchObject({
        name: 'contract/one',
        commit: {sha: BASE},
      });
      expect(deleted.status).toBe(204);
      expect(gone.status).toBe(404);
      expect(deletedAgain.status).toBe(422);
      expect(mock.writes()).toEqual([
        {
          kind: 'github.create_branch',
          target: 'acme/app:contract/one',
          payload: {repository: 'acme/app', branch: 'contract/one', sha: BASE},
        },
        {
          kind: 'github.delete_branch',
          target: 'acme/app:contract/one',
          payload: {repository: 'acme/app', branch: 'contract/one'},
        },
      ]);
    } finally {
      await mock.stop();
    }
  });

  it('makes a commit that the commit reads find, and records it once the branch moves', async () => {
    const {mock, request} = await startMock();

    try {
      await request('POST', '/repos/acme/app/git/refs', {ref: 'refs/heads/work', sha: BASE});
      const blob = await request('POST', '/repos/acme/app/git/blobs', {content: 'Hello'});
      const {sha: blobSha} = (await blob.json()) as {sha: string};
      // The Git hash of the text `Hello`.
      expect(blobSha).toBe('5ab2f8a4323abafb10abb68657d9d39f1a775057');
      const tree = await request('POST', '/repos/acme/app/git/trees', {
        base_tree: 'x',
        tree: [{path: 'note.md', mode: '100644', type: 'blob', sha: blobSha}],
      });
      const {sha: treeSha} = (await tree.json()) as {sha: string};
      const commit = await request('POST', '/repos/acme/app/git/commits', {
        message: 'Add a note',
        tree: treeSha,
        parents: [BASE],
      });
      const {sha} = (await commit.json()) as {sha: string};
      const moved = await request('PATCH', '/repos/acme/app/git/refs/heads/work', {sha});
      const read = await request('GET', `/repos/acme/app/commits/${sha}`);
      const tip = await request('GET', '/repos/acme/app/branches/work');

      expect(moved.status).toBe(200);
      await expect(read.json()).resolves.toMatchObject({
        sha,
        commit: {message: 'Add a note', verification: {verified: true}},
        parents: [{sha: BASE}],
      });
      await expect(tip.json()).resolves.toMatchObject({commit: {sha}});
      expect(mock.writes().map((write) => write.kind)).toEqual([
        'github.create_branch',
        'github.create_commit',
      ]);
      expect(mock.writes()[1]).toMatchObject({
        target: 'acme/app:work',
        payload: {parent_oid: BASE, oid: sha, message: 'Add a note'},
      });
    } finally {
      await mock.stop();
    }
  });
});
