import {Buffer} from 'node:buffer';
import {IntegrationProviderError, MAX_REPOSITORY_FILE_BYTES} from '@shipfox/api-integration-spi';
import {and, count, eq} from 'drizzle-orm';
import {hashBlob} from 'isomorphic-git';
import {
  commitManagedChanges,
  MAX_COMMIT_BYTES,
  MAX_COMMIT_FILES,
  ManagedCommitRefusedError,
  type ManagedFileChange,
} from '#core/commit-changes.js';
import {ManagedSourceControlProvider} from '#core/source-control.js';
import {db} from '#db/db.js';
import {managedObjects} from '#db/schema/objects.js';
import {managedRepositories} from '#db/schema/repositories.js';
import {createRepositoryRow, managedConnection, seedCommits} from '#test/fixtures/repository.js';

const provider = new ManagedSourceControlProvider();
const WORKFLOW = '.shipfox/workflows/triage.yml';
const PROMPT = '.shipfox/prompts/triage.md';
const AUTHOR = {name: 'Ada', email: 'ada-id@users.noreply.shipfox.io'};

async function seedRepository() {
  const repository = await createRepositoryRow();
  const [main] = await seedCommits({
    repositoryId: repository.id,
    commits: [
      {files: [{path: WORKFLOW, content: 'name: Triage\n'}], message: 'Create the project'},
    ],
  });
  if (!main) throw new Error('The seed produced no commit');
  return {...repository, main};
}

type Repository = Awaited<ReturnType<typeof seedRepository>>;

function commit(
  repository: Repository,
  overrides: {
    branch?: string;
    expectedHead?: string | undefined;
    changes?: readonly ManagedFileChange[];
    message?: string;
  } = {},
) {
  return commitManagedChanges({
    workspaceId: repository.workspaceId,
    repositoryId: repository.id,
    branch: overrides.branch ?? 'shipfox/add-prompt',
    expectedHead: overrides.expectedHead,
    message: overrides.message ?? 'Add a prompt',
    changes: overrides.changes ?? [{path: PROMPT, content: 'Triage it.\n'}],
    author: AUTHOR,
  });
}

function read(repository: Repository, ref: string, path: string) {
  return provider.fetchFile({
    connection: managedConnection(repository.workspaceId),
    externalRepositoryId: repository.externalRepositoryId,
    ref,
    path,
  });
}

function listPaths(repository: Repository, ref: string) {
  return provider
    .listFiles({
      connection: managedConnection(repository.workspaceId),
      externalRepositoryId: repository.externalRepositoryId,
      ref,
      prefix: '.shipfox/',
      limit: 500,
    })
    .then((page) => page.files.map((file) => file.path));
}

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ManagedCommitRefusedError) {
      return {refusal: error.refusal, details: error.details};
    }
    throw error;
  }
  throw new Error('The commit was not refused');
}

async function objectCount(repository: Repository): Promise<number> {
  const [row] = await db()
    .select({value: count()})
    .from(managedObjects)
    .where(eq(managedObjects.repositoryId, repository.id));
  return row?.value ?? 0;
}

describe('commitManagedChanges', () => {
  it('creates the branch from main on the first commit', async () => {
    const repository = await seedRepository();

    const result = await commit(repository);

    expect(result.branch).toBe('shipfox/add-prompt');
    expect(result.parent).toBe(repository.main);
    expect(await listPaths(repository, 'shipfox/add-prompt')).toEqual([PROMPT, WORKFLOW]);
    expect((await read(repository, result.commit, PROMPT)).content).toBe('Triage it.\n');
    expect(await listPaths(repository, 'main')).toEqual([WORKFLOW]);
  });

  it('applies several changes in one commit, with the author and the message', async () => {
    const repository = await seedRepository();

    const result = await commit(repository, {
      message: 'Rework triage',
      changes: [
        {path: WORKFLOW, content: 'name: Triage v2\n'},
        {path: PROMPT, content: 'Triage it.\n'},
        {path: '.shipfox/agents/triager.md', content: 'You triage.\n'},
      ],
    });

    expect(await listPaths(repository, result.commit)).toEqual([
      '.shipfox/agents/triager.md',
      PROMPT,
      WORKFLOW,
    ]);
    expect((await read(repository, result.commit, WORKFLOW)).content).toBe('name: Triage v2\n');
    const history = await provider.listCommits({
      connection: managedConnection(repository.workspaceId),
      externalRepositoryId: repository.externalRepositoryId,
      ref: result.commit,
      path: '.shipfox',
      limit: 10,
    });
    expect(history.commits[0]).toMatchObject({
      oid: result.commit,
      message: 'Rework triage',
      authorName: 'Ada',
    });
  });

  it('continues a branch from the head the caller saw', async () => {
    const repository = await seedRepository();
    const first = await commit(repository);

    const second = await commit(repository, {
      expectedHead: first.commit,
      message: 'Delete the workflow',
      changes: [{path: WORKFLOW, content: null}],
    });

    expect(second.parent).toBe(first.commit);
    expect(await listPaths(repository, second.commit)).toEqual([PROMPT]);
  });

  it('removes a folder that ends up empty', async () => {
    const repository = await seedRepository();

    const result = await commit(repository, {changes: [{path: WORKFLOW, content: null}]});

    expect(await listPaths(repository, result.commit)).toEqual([]);
  });

  it('refuses the default branch, by name or by ref', async () => {
    const repository = await seedRepository();

    for (const branch of ['main', 'refs/heads/main']) {
      expect(await refusal(commit(repository, {branch}))).toEqual({
        refusal: 'protected-branch',
        details: {branch: 'main'},
      });
    }
    expect(await listPaths(repository, 'main')).toEqual([WORKFLOW]);
  });

  it.each([
    ['a commit id', 'a'.repeat(40)],
    ['a pull request ref', 'refs/pull/1/head'],
    ['a name with a space', 'my branch'],
    ['a name with a parent segment', 'a/../b'],
  ])('refuses %s as a branch', async (_label, branch) => {
    const repository = await seedRepository();

    const result = await refusal(commit(repository, {branch}));

    expect(result.refusal).toBe('branch-invalid');
  });

  it('answers stale-head with the current head when the branch already exists', async () => {
    const repository = await seedRepository();
    const first = await commit(repository);

    const result = await refusal(commit(repository));

    expect(result).toEqual({
      refusal: 'stale-head',
      details: {branch: 'shipfox/add-prompt', head: first.commit},
    });
  });

  it('answers stale-head when the expected head is behind', async () => {
    const repository = await seedRepository();
    const first = await commit(repository);
    const second = await commit(repository, {
      expectedHead: first.commit,
      changes: [{path: PROMPT, content: 'Triage it better.\n'}],
    });

    const result = await refusal(commit(repository, {expectedHead: first.commit}));

    expect(result.details.head).toBe(second.commit);
  });

  it('answers stale-head with no head when the branch to continue does not exist', async () => {
    const repository = await seedRepository();

    const result = await refusal(commit(repository, {expectedHead: repository.main}));

    expect(result).toEqual({
      refusal: 'stale-head',
      details: {branch: 'shipfox/add-prompt', head: null},
    });
  });

  it('lets one of two racing commits on an existing branch win', async () => {
    const repository = await seedRepository();
    const first = await commit(repository);

    const results = await Promise.allSettled([
      commit(repository, {
        expectedHead: first.commit,
        changes: [{path: PROMPT, content: 'Racer one.\n'}],
      }),
      commit(repository, {
        expectedHead: first.commit,
        changes: [{path: PROMPT, content: 'Racer two.\n'}],
      }),
    ]);

    const winners = results.filter((result) => result.status === 'fulfilled');
    const losers = results.filter((result) => result.status === 'rejected');
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    const failure = (losers[0] as PromiseRejectedResult).reason;
    expect(failure).toBeInstanceOf(ManagedCommitRefusedError);
    expect(failure.refusal).toBe('stale-head');
    const winner = (winners[0] as PromiseFulfilledResult<{commit: string}>).value;
    expect(failure.details.head).toBe(winner.commit);
  });

  it('stores no object of the commit that loses a concurrent race', async () => {
    const repository = await seedRepository();
    const first = await commit(repository);
    const contents = ['Racer one, with its own text.\n', 'Racer two, with its own text.\n'];

    const results = await Promise.allSettled(
      contents.map((content) =>
        commit(repository, {expectedHead: first.commit, changes: [{path: PROMPT, content}]}),
      ),
    );

    const loserIndex = results.findIndex((result) => result.status === 'rejected');
    const loserBlob = await hashBlob({object: Buffer.from(contents[loserIndex] ?? '')});
    const [stored] = await db()
      .select({value: count()})
      .from(managedObjects)
      .where(
        and(eq(managedObjects.repositoryId, repository.id), eq(managedObjects.oid, loserBlob.oid)),
      );
    expect(loserIndex).toBeGreaterThanOrEqual(0);
    expect(stored?.value).toBe(0);
  });

  it('lets one of two racing commits create the same branch', async () => {
    const repository = await seedRepository();

    const results = await Promise.allSettled([
      commit(repository, {changes: [{path: PROMPT, content: 'Racer one.\n'}]}),
      commit(repository, {changes: [{path: PROMPT, content: 'Racer two.\n'}]}),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const [loser] = results.filter((result) => result.status === 'rejected');
    expect((loser as PromiseRejectedResult).reason).toMatchObject({refusal: 'stale-head'});
  });

  it('leaves no object behind when a race is lost', async () => {
    const repository = await seedRepository();
    const first = await commit(repository);
    await commit(repository, {
      expectedHead: first.commit,
      changes: [{path: PROMPT, content: 'Winner.\n'}],
    });
    const before = await objectCount(repository);

    await refusal(
      commit(repository, {
        expectedHead: first.commit,
        changes: [{path: PROMPT, content: 'Loser, with content nobody else wrote.\n'}],
      }),
    );

    expect(await objectCount(repository)).toBe(before);
  });

  it.each([
    'linking',
    'linked',
  ] as const)('refuses a commit while the repository is %s', async (status) => {
    const repository = await seedRepository();
    await db()
      .update(managedRepositories)
      .set({status})
      .where(eq(managedRepositories.id, repository.id));
    const before = await objectCount(repository);

    const result = await refusal(commit(repository));

    expect(result.refusal).toBe('move-in-progress');
    expect(await objectCount(repository)).toBe(before);
  });

  it('refuses a commit that changes nothing', async () => {
    const repository = await seedRepository();

    const result = await refusal(
      commit(repository, {changes: [{path: WORKFLOW, content: 'name: Triage\n'}]}),
    );

    expect(result.refusal).toBe('no-changes');
    expect(await refusal(commit(repository, {changes: []}))).toMatchObject({
      refusal: 'no-changes',
    });
  });

  it('refuses to delete a file that is not there', async () => {
    const repository = await seedRepository();

    for (const path of ['.shipfox/workflows/missing.yml', '.shipfox/nothing/here.yml']) {
      const result = await refusal(commit(repository, {changes: [{path, content: null}]}));
      expect(result).toEqual({refusal: 'file-not-found', details: {path}});
    }
  });

  it.each([
    ['outside .shipfox', 'src/index.ts'],
    ['the root itself', '.shipfox'],
    ['a parent segment', '.shipfox/../secrets.txt'],
    ['a .git segment', '.shipfox/.git/config'],
    ['an empty segment', '.shipfox//a.yml'],
    ['a backslash', '.shipfox/a\\b.yml'],
    ['a control character', '.shipfox/a\nb.yml'],
    ['a folder where a file is', '.shipfox/workflows/triage.yml/inner.yml'],
    ['a file where a folder is', '.shipfox/workflows'],
  ])('refuses a path with %s', async (_label, path) => {
    const repository = await seedRepository();

    const result = await refusal(commit(repository, {changes: [{path, content: 'x\n'}]}));

    expect(result).toEqual({refusal: 'path-not-allowed', details: {path}});
    expect(await listPaths(repository, 'main')).toEqual([WORKFLOW]);
  });

  it('refuses the same path twice, and a file that shares a path with a folder', async () => {
    const repository = await seedRepository();

    expect(
      await refusal(
        commit(repository, {
          changes: [
            {path: PROMPT, content: 'a\n'},
            {path: PROMPT, content: 'b\n'},
          ],
        }),
      ),
    ).toMatchObject({refusal: 'path-not-allowed'});
    expect(
      await refusal(
        commit(repository, {
          changes: [
            {path: '.shipfox/a', content: 'a\n'},
            {path: '.shipfox/a/b.yml', content: 'b\n'},
          ],
        }),
      ),
    ).toMatchObject({refusal: 'path-not-allowed'});
  });

  it('refuses content that is not text', async () => {
    const repository = await seedRepository();

    for (const content of ['binary\u0000data', 'lone \ud800 surrogate']) {
      const result = await refusal(commit(repository, {changes: [{path: PROMPT, content}]}));
      expect(result).toEqual({refusal: 'content-not-text', details: {path: PROMPT}});
    }
  });

  it('enforces the file, file count, and commit size limits', async () => {
    const repository = await seedRepository();

    expect(
      await refusal(
        commit(repository, {
          changes: [{path: PROMPT, content: 'x'.repeat(MAX_REPOSITORY_FILE_BYTES + 1)}],
        }),
      ),
    ).toEqual({refusal: 'file-too-large', details: {path: PROMPT}});

    const many = Array.from({length: MAX_COMMIT_FILES + 1}, (_, index) => ({
      path: `.shipfox/prompts/${index}.md`,
      content: 'x\n',
    }));
    expect((await refusal(commit(repository, {changes: many}))).refusal).toBe('too-many-changes');

    const half = Math.floor(MAX_COMMIT_BYTES / 2) + 1;
    expect(
      (
        await refusal(
          commit(repository, {
            changes: [
              {path: '.shipfox/prompts/a.md', content: 'x'.repeat(half)},
              {path: '.shipfox/prompts/b.md', content: 'x'.repeat(half)},
            ],
          }),
        )
      ).refusal,
    ).toBe('commit-too-large');
  });

  it('accepts a commit at the limits', async () => {
    const repository = await seedRepository();
    const changes = Array.from({length: MAX_COMMIT_FILES}, (_, index) => ({
      path: `.shipfox/prompts/${index}.md`,
      content: `${index}\n`,
    }));

    const result = await commit(repository, {changes});

    expect(await listPaths(repository, result.commit)).toHaveLength(MAX_COMMIT_FILES + 1);
    expect(Buffer.byteLength(changes.map((change) => change.content).join(''))).toBeLessThan(
      MAX_COMMIT_BYTES,
    );
  });

  it('answers repository-not-found for a repository of another workspace', async () => {
    const repository = await seedRepository();

    const failure = await commitManagedChanges({
      workspaceId: crypto.randomUUID(),
      repositoryId: repository.id,
      branch: 'shipfox/add-prompt',
      message: 'Add a prompt',
      changes: [{path: PROMPT, content: 'x\n'}],
      author: AUTHOR,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(IntegrationProviderError);
    expect((failure as IntegrationProviderError).reason).toBe('repository-not-found');
  });
});
