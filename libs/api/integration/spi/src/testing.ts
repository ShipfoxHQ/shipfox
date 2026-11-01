import assert from 'node:assert/strict';
import {
  type IntegrationConnection,
  IntegrationProviderError,
  type IntegrationProviderErrorReason,
  type SourceControlProvider,
} from '#contracts.js';

export interface SourceControlContractFile {
  path: string;
  content: string;
}

export interface SourceControlContractRepository<Connection extends IntegrationConnection> {
  connection: Connection;
  /** A connection that must not reach this repository. */
  foreignConnection: Connection;
  externalRepositoryId: string;
  /** Commit ids on `refs/heads/main`, oldest first. */
  commits: readonly string[];
}

export interface SourceControlContractHarness<Connection extends IntegrationConnection> {
  provider: SourceControlProvider<Connection>;
  /** Creates a repository with one commit on `main` per entry. Each commit adds to the last. */
  createRepository(
    commits: readonly (readonly SourceControlContractFile[])[],
  ): Promise<SourceControlContractRepository<Connection>>;
}

export interface SourceControlContractCase {
  name: string;
  run<Connection extends IntegrationConnection>(
    harness: SourceControlContractHarness<Connection>,
  ): Promise<void>;
}

const MAIN = 'refs/heads/main';

/**
 * The behavior every source control provider shares. Run them with
 * `it.each(sourceControlContractCases)`, so a provider and the fakes that stand
 * in for it can't drift apart. Cursors stay opaque here, because each provider
 * owns its format.
 */
export const sourceControlContractCases: readonly SourceControlContractCase[] = [
  {
    name: 'resolves a repository by its external id',
    async run({provider, createRepository}) {
      const {connection, externalRepositoryId} = await createRepository([
        [{path: 'README.md', content: 'hello'}],
      ]);

      const repository = await provider.resolveRepository({connection, externalRepositoryId});

      assert.equal(repository.externalRepositoryId, externalRepositoryId);
      assert.equal(repository.defaultBranch, 'main');
    },
  },
  {
    name: 'hides a repository from a connection that does not own it',
    async run({provider, createRepository}) {
      const {foreignConnection, externalRepositoryId} = await createRepository([
        [{path: 'README.md', content: 'hello'}],
      ]);

      await assertProviderError(
        () => provider.resolveRepository({connection: foreignConnection, externalRepositoryId}),
        'repository-not-found',
      );
    },
  },
  {
    name: 'resolves a branch to its head commit',
    async run({provider, createRepository}) {
      const {connection, externalRepositoryId, commits} = await createRepository([
        [{path: 'first.md', content: 'one'}],
        [{path: 'second.md', content: 'two'}],
      ]);

      const resolved = await provider.resolveRef({connection, externalRepositoryId, ref: MAIN});

      assert.deepEqual(resolved, {ref: MAIN, commit: commits[1]});
    },
  },
  {
    name: 'refuses a pull request ref',
    async run({provider, createRepository}) {
      const {connection, externalRepositoryId} = await createRepository([
        [{path: 'README.md', content: 'hello'}],
      ]);

      await assertProviderError(
        () => provider.resolveRef({connection, externalRepositoryId, ref: 'refs/pull/1/head'}),
        'ref-invalid',
      );
    },
  },
  {
    name: 'reports a branch that does not exist',
    async run({provider, createRepository}) {
      const {connection, externalRepositoryId} = await createRepository([
        [{path: 'README.md', content: 'hello'}],
      ]);

      await assertProviderError(
        () => provider.resolveRef({connection, externalRepositoryId, ref: 'refs/heads/missing'}),
        'ref-not-found',
      );
    },
  },
  {
    name: 'lists the files under a prefix in path order',
    async run({provider, createRepository}) {
      const {connection, externalRepositoryId} = await createRepository([
        [
          {path: '.shipfox/workflows/b.yml', content: 'b'},
          {path: '.shipfox/workflows/a.yml', content: 'a'},
          {path: '.shipfox/prompts/triage.md', content: 'prompt'},
          {path: '.shipfox-other/c.yml', content: 'c'},
          {path: 'README.md', content: 'hello'},
        ],
      ]);

      const page = await provider.listFiles({
        connection,
        externalRepositoryId,
        ref: MAIN,
        prefix: '.shipfox/',
        limit: 10,
      });

      assert.deepEqual(
        page.files.map((file) => [file.path, file.type]),
        [
          ['.shipfox/prompts/triage.md', 'file'],
          ['.shipfox/workflows/a.yml', 'file'],
          ['.shipfox/workflows/b.yml', 'file'],
        ],
      );
      assert.equal(page.nextCursor, null);
    },
  },
  {
    name: 'pages through a file listing',
    async run({provider, createRepository}) {
      const {connection, externalRepositoryId} = await createRepository([
        [
          {path: 'a.md', content: 'a'},
          {path: 'b.md', content: 'b'},
          {path: 'c.md', content: 'c'},
        ],
      ]);
      const list = {connection, externalRepositoryId, ref: MAIN, prefix: '', limit: 2};

      const first = await provider.listFiles(list);
      assert.notEqual(first.nextCursor, null);
      const second = await provider.listFiles({...list, cursor: first.nextCursor ?? undefined});

      assert.deepEqual(
        [...first.files, ...second.files].map((file) => file.path),
        ['a.md', 'b.md', 'c.md'],
      );
      assert.equal(second.nextCursor, null);
    },
  },
  {
    name: 'lists files at a pinned commit',
    async run({provider, createRepository}) {
      const {connection, externalRepositoryId, commits} = await createRepository([
        [{path: 'first.md', content: 'one'}],
        [{path: 'second.md', content: 'two'}],
      ]);

      const page = await provider.listFiles({
        connection,
        externalRepositoryId,
        ref: requireCommit(commits, 0),
        prefix: '',
        limit: 10,
      });

      assert.deepEqual(
        page.files.map((file) => file.path),
        ['first.md'],
      );
    },
  },
  {
    name: 'reads a file at a branch and at a pinned commit',
    async run({provider, createRepository}) {
      const {connection, externalRepositoryId, commits} = await createRepository([
        [{path: 'dir/file.md', content: 'old'}],
        [{path: 'dir/file.md', content: 'new'}],
      ]);
      const read = {connection, externalRepositoryId, path: 'dir/file.md'};
      const pinned = requireCommit(commits, 0);

      const atBranch = await provider.fetchFile({...read, ref: MAIN});
      const atCommit = await provider.fetchFile({...read, ref: pinned});

      assert.deepEqual(atBranch, {path: 'dir/file.md', ref: MAIN, content: 'new'});
      assert.deepEqual(atCommit, {path: 'dir/file.md', ref: pinned, content: 'old'});
    },
  },
  {
    name: 'reports a file that does not exist',
    async run({provider, createRepository}) {
      const {connection, externalRepositoryId} = await createRepository([
        [{path: 'README.md', content: 'hello'}],
      ]);

      await assertProviderError(
        () => provider.fetchFile({connection, externalRepositoryId, ref: MAIN, path: 'missing.md'}),
        'file-not-found',
      );
    },
  },
];

function requireCommit(commits: readonly string[], index: number): string {
  const commit = commits[index];
  if (commit === undefined) throw new Error(`The harness returned no commit ${index}`);
  return commit;
}

async function assertProviderError(
  action: () => Promise<unknown>,
  reason: IntegrationProviderErrorReason,
): Promise<void> {
  await assert.rejects(
    async () => await action(),
    (error) => error instanceof IntegrationProviderError && error.reason === reason,
  );
}
