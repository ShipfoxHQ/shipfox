import {Buffer} from 'node:buffer';
import {IntegrationProviderError, MAX_REPOSITORY_FILE_BYTES} from '@shipfox/api-integration-spi';
import {reportError} from '@shipfox/node-error-monitoring';
import {and, eq, ne} from 'drizzle-orm';
import {ManagedSourceControlProvider} from '#core/source-control.js';
import {db} from '#db/db.js';
import {managedObjects} from '#db/schema/objects.js';
import {managedRefs} from '#db/schema/refs.js';
import {managedRepositories} from '#db/schema/repositories.js';
import {createRepositoryRow, managedConnection, seedCommits} from '#test/fixtures/repository.js';

vi.mock('@shipfox/node-error-monitoring', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shipfox/node-error-monitoring')>()),
  reportError: vi.fn(),
}));

const provider = new ManagedSourceControlProvider();
const FILE = '.shipfox/workflows/triage.yml';

function reasonOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => (error instanceof IntegrationProviderError ? error.reason : error),
  );
}

describe('ManagedSourceControlProvider', () => {
  describe('repositories', () => {
    it('describes a repository with no clone or web location', async () => {
      const repository = await createRepositoryRow();

      const snapshot = await provider.resolveRepository(repository);

      expect(snapshot).toEqual({
        externalRepositoryId: repository.externalRepositoryId,
        owner: 'shipfox',
        name: repository.id,
        fullName: `shipfox/${repository.id}`,
        defaultBranch: 'main',
        visibility: 'private',
        cloneUrl: '',
        htmlUrl: '',
      });
    });

    it.each([
      ['a value that is not a UUID', 'managed:acme/config'],
      ['another provider', 'github:01890000-0000-7000-8000-000000000001'],
      ['an unknown repository', 'managed:01890000-0000-7000-8000-000000000001'],
    ])('reports %s as not found', async (_, externalRepositoryId) => {
      const {connection} = await createRepositoryRow();

      const reason = await reasonOf(provider.resolveRepository({connection, externalRepositoryId}));

      expect(reason).toBe('repository-not-found');
    });

    it("lists only the connection's workspace, in pages", async () => {
      const first = await createRepositoryRow();
      const second = await createRepositoryRow(first.workspaceId);
      await createRepositoryRow();
      const list = {connection: first.connection, limit: 1};

      const firstPage = await provider.listRepositories(list);
      const secondPage = await provider.listRepositories({
        ...list,
        cursor: firstPage.nextCursor ?? undefined,
      });

      const names = [...firstPage.repositories, ...secondPage.repositories].map(
        (repository) => repository.name,
      );
      expect(names.sort()).toEqual([first.id, second.id].sort());
      expect(secondPage.nextCursor).toBeNull();
    });

    it.each([
      ['part of the name', (id: string) => id.slice(4, 12)],
      ['the name in another case', (id: string) => id.toUpperCase()],
      ['the owner', () => ' SHIPFOX/ '],
    ])('searches by %s', async (_, search) => {
      const {id, connection} = await createRepositoryRow();

      const page = await provider.listRepositories({
        connection,
        limit: 10,
        search: search(id),
      });

      expect(page.repositories.map((repository) => repository.name)).toEqual([id]);
    });

    it('lists nothing for a search that matches no repository', async () => {
      const {connection} = await createRepositoryRow();

      const page = await provider.listRepositories({connection, limit: 10, search: 'payments'});

      expect(page).toEqual({repositories: [], nextCursor: null});
    });

    it.each([
      'abc',
      '1e+23',
      '-1',
      '12abc',
      '',
    ])('refuses the repository cursor %j', async (cursor) => {
      const {connection} = await createRepositoryRow();

      const reason = await reasonOf(provider.listRepositories({connection, limit: 10, cursor}));

      expect(reason).toBe('provider-rejected');
    });

    it('resolves no trigger reference', () => {
      const reference = provider.resolveTriggerReference();

      expect(reference).toBeNull();
    });

    it('offers no checkout', () => {
      expect(provider).not.toHaveProperty('createCheckoutSpec');
      expect(provider).not.toHaveProperty('createCheckoutCredentials');
    });
  });

  describe('workspace isolation', () => {
    it('refuses every read from another workspace', async () => {
      const {id, externalRepositoryId} = await createRepositoryRow();
      await seedCommits({
        repositoryId: id,
        commits: [{files: [{path: FILE, content: 'on: push'}]}],
      });
      const input = {
        connection: managedConnection(crypto.randomUUID()),
        externalRepositoryId,
        ref: 'main',
      };

      const reasons = await Promise.all([
        reasonOf(provider.resolveRef(input)),
        reasonOf(provider.listFiles({...input, prefix: '', limit: 10})),
        reasonOf(provider.fetchFile({...input, path: FILE})),
        reasonOf(provider.listCommits({...input, path: FILE, limit: 10})),
      ]);

      expect(reasons).toEqual(Array(4).fill('repository-not-found'));
    });

    it("doesn't read a commit that only another repository holds", async () => {
      const other = await createRepositoryRow();
      const [foreignCommit] = await seedCommits({
        repositoryId: other.id,
        commits: [{files: [{path: FILE, content: 'secret'}]}],
      });
      const {id, connection, externalRepositoryId} = await createRepositoryRow();
      await seedCommits({repositoryId: id, commits: [{files: [{path: FILE, content: 'mine'}]}]});

      const reason = await reasonOf(
        provider.fetchFile({
          connection,
          externalRepositoryId,
          ref: foreignCommit as string,
          path: FILE,
        }),
      );

      expect(reason).toBe('ref-not-found');
    });
  });

  describe('resolveRef', () => {
    it.each(['main', 'refs/heads/main'])('accepts %s', async (ref) => {
      const {id, connection, externalRepositoryId} = await createRepositoryRow();
      const [commit] = await seedCommits({repositoryId: id, commits: [{files: []}]});

      const resolved = await provider.resolveRef({connection, externalRepositoryId, ref});

      expect(resolved).toEqual({ref, commit});
    });

    it('accepts a branch name with a slash', async () => {
      const {id, connection, externalRepositoryId} = await createRepositoryRow();
      const [commit] = await seedCommits({
        repositoryId: id,
        branch: 'shipfox/add-triage',
        commits: [{files: []}],
      });

      const resolved = await provider.resolveRef({
        connection,
        externalRepositoryId,
        ref: 'shipfox/add-triage',
      });

      expect(resolved.commit).toBe(commit);
    });

    it.each([
      ['a tag, because tags do not exist', 'refs/tags/v1', 'ref-not-found'],
      ['an unknown branch', 'missing', 'ref-not-found'],
      ['a pull request ref', 'refs/pull/1/head', 'ref-invalid'],
      ['a parent traversal', 'refs/heads/../../config', 'ref-invalid'],
      ['an option-shaped name', 'refs/heads/-x y', 'ref-invalid'],
      ['an object id', 'a'.repeat(40), 'ref-invalid'],
    ])('answers %s', async (_, ref, expected) => {
      const {id, connection, externalRepositoryId} = await createRepositoryRow();
      await seedCommits({repositoryId: id, commits: [{files: []}]});

      const reason = await reasonOf(provider.resolveRef({connection, externalRepositoryId, ref}));

      expect(reason).toBe(expected);
    });
  });

  describe('listFiles', () => {
    it('reports every file as a file of unknown size', async () => {
      const {id, connection, externalRepositoryId} = await createRepositoryRow();
      await seedCommits({
        repositoryId: id,
        commits: [{files: [{path: FILE, content: 'on: push'}]}],
      });

      const page = await provider.listFiles({
        connection,
        externalRepositoryId,
        ref: 'main',
        prefix: '.shipfox',
        limit: 10,
      });

      expect(page).toEqual({files: [{path: FILE, type: 'file', size: null}], nextCursor: null});
    });

    it('lists symlinks and submodules so callers can reject them', async () => {
      const {id, connection, externalRepositoryId} = await createRepositoryRow();
      await seedCommits({
        repositoryId: id,
        commits: [
          {
            files: [
              {path: 'action/index.js', content: 'run()'},
              {path: 'action/link', content: {symlink: 'index.js'}},
              {path: 'action/vendor', content: {submodule: 'a'.repeat(40)}},
            ],
          },
        ],
      });

      const page = await provider.listFiles({
        connection,
        externalRepositoryId,
        ref: 'main',
        prefix: 'action/',
        limit: 10,
      });

      expect(page.files).toEqual([
        {path: 'action/index.js', type: 'file', size: null},
        {path: 'action/link', type: 'symlink', size: null},
        {path: 'action/vendor', type: 'submodule', size: null},
      ]);
    });

    it('uses the last path as the cursor', async () => {
      const {id, connection, externalRepositoryId} = await createRepositoryRow();
      await seedCommits({
        repositoryId: id,
        commits: [
          {
            files: [
              {path: 'a.md', content: 'a'},
              {path: 'b.md', content: 'b'},
            ],
          },
        ],
      });

      const page = await provider.listFiles({
        connection,
        externalRepositoryId,
        ref: 'main',
        prefix: '',
        limit: 1,
      });

      expect(page.nextCursor).toBe('a.md');
    });

    it('lists nothing on the empty tree', async () => {
      const {id, connection, externalRepositoryId} = await createRepositoryRow();
      await seedCommits({repositoryId: id, commits: [{files: []}]});

      const page = await provider.listFiles({
        connection,
        externalRepositoryId,
        ref: 'main',
        prefix: '.shipfox/',
        limit: 10,
      });

      expect(page).toEqual({files: [], nextCursor: null});
    });

    it('lists nothing under a prefix that does not exist', async () => {
      const {id, connection, externalRepositoryId} = await createRepositoryRow();
      await seedCommits({repositoryId: id, commits: [{files: [{path: 'a.md', content: 'a'}]}]});

      const page = await provider.listFiles({
        connection,
        externalRepositoryId,
        ref: 'main',
        prefix: '.shipfox/',
        limit: 10,
      });

      expect(page.files).toEqual([]);
    });

    it('accepts a file as the prefix', async () => {
      const {id, connection, externalRepositoryId} = await createRepositoryRow();
      await seedCommits({
        repositoryId: id,
        commits: [{files: [{path: FILE, content: 'on: push'}]}],
      });

      const page = await provider.listFiles({
        connection,
        externalRepositoryId,
        ref: 'main',
        prefix: FILE,
        limit: 10,
      });

      expect(page.files.map((file) => file.path)).toEqual([FILE]);
    });
  });

  describe('fetchFile', () => {
    it.each([
      ['a folder', '.shipfox/workflows'],
      ['a path through a file', `${FILE}/nested`],
      ['a parent traversal', '.shipfox/../.git/config'],
    ])('reports %s as not found', async (_, path) => {
      const {id, connection, externalRepositoryId} = await createRepositoryRow();
      await seedCommits({
        repositoryId: id,
        commits: [{files: [{path: FILE, content: 'on: push'}]}],
      });

      const reason = await reasonOf(
        provider.fetchFile({connection, externalRepositoryId, ref: 'main', path}),
      );

      expect(reason).toBe('file-not-found');
    });

    it.each([
      ['a symlink', {symlink: 'target.md'}],
      ['a submodule', {submodule: 'a'.repeat(40)}],
    ])('reports %s as not found', async (_, content) => {
      const {id, connection, externalRepositoryId} = await createRepositoryRow();
      await seedCommits({repositoryId: id, commits: [{files: [{path: 'entry', content}]}]});

      const reason = await reasonOf(
        provider.fetchFile({connection, externalRepositoryId, ref: 'main', path: 'entry'}),
      );

      expect(reason).toBe('file-not-found');
    });

    it.each([
      ['an uppercase commit id', 'A'.repeat(40)],
      ['a SHA-256 commit id', 'a'.repeat(64)],
    ])('reports %s as a missing ref', async (_, ref) => {
      const {id, connection, externalRepositoryId} = await createRepositoryRow();
      await seedCommits({
        repositoryId: id,
        commits: [{files: [{path: FILE, content: 'on: push'}]}],
      });

      const reason = await reasonOf(
        provider.fetchFile({connection, externalRepositoryId, ref, path: FILE}),
      );

      expect(reason).toBe('ref-not-found');
    });

    it('reports a commit that does not exist as a missing ref', async () => {
      const {id, connection, externalRepositoryId} = await createRepositoryRow();
      await seedCommits({
        repositoryId: id,
        commits: [{files: [{path: FILE, content: 'on: push'}]}],
      });

      const reason = await reasonOf(
        provider.fetchFile({connection, externalRepositoryId, ref: 'a'.repeat(40), path: FILE}),
      );

      expect(reason).toBe('ref-not-found');
    });

    it('reports an object that is not a commit as a missing ref', async () => {
      const {id, connection, externalRepositoryId} = await createRepositoryRow();
      const [commit] = await seedCommits({
        repositoryId: id,
        commits: [{files: [{path: FILE, content: 'on: push'}]}],
      });
      const [tree] = await db()
        .select({oid: managedObjects.oid})
        .from(managedObjects)
        .where(and(eq(managedObjects.repositoryId, id), ne(managedObjects.oid, commit as string)))
        .limit(1);

      const reason = await reasonOf(
        provider.fetchFile({
          connection,
          externalRepositoryId,
          ref: tree?.oid as string,
          path: FILE,
        }),
      );

      expect(reason).toBe('ref-not-found');
    });

    it('refuses a file over the size limit', async () => {
      const {id, connection, externalRepositoryId} = await createRepositoryRow();
      await seedCommits({
        repositoryId: id,
        commits: [{files: [{path: 'big.md', content: 'a'.repeat(MAX_REPOSITORY_FILE_BYTES + 1)}]}],
      });

      const reason = await reasonOf(
        provider.fetchFile({connection, externalRepositoryId, ref: 'main', path: 'big.md'}),
      );

      expect(reason).toBe('content-too-large');
    });

    it('refuses a file that is not text', async () => {
      const {id, connection, externalRepositoryId} = await createRepositoryRow();
      await seedCommits({
        repositoryId: id,
        commits: [{files: [{path: 'logo.png', content: Uint8Array.of(0xff, 0xfe, 0x00)}]}],
      });

      const reason = await reasonOf(
        provider.fetchFile({connection, externalRepositoryId, ref: 'main', path: 'logo.png'}),
      );

      expect(reason).toBe('binary-file-unsupported');
    });
  });

  describe('listCommits', () => {
    async function seedHistory() {
      const repository = await createRepositoryRow();
      const oids = await seedCommits({
        repositoryId: repository.id,
        commits: [
          {
            message: 'Add triage',
            author: 'Ada',
            timestamp: 1_790_000_000,
            files: [{path: FILE, content: 'v1'}],
          },
          {message: 'Add docs', files: [{path: 'README.md', content: 'hello'}]},
          {message: 'Change triage', author: 'Lin', files: [{path: FILE, content: 'v2'}]},
          {message: 'Add other', files: [{path: '.shipfox/workflows/other.yml', content: 'x'}]},
          {message: 'Remove triage', deletes: [FILE]},
        ],
      });
      return {...repository, oids};
    }

    it('keeps the commits that changed a file, newest first', async () => {
      const {connection, externalRepositoryId, oids} = await seedHistory();

      const page = await provider.listCommits({
        connection,
        externalRepositoryId,
        ref: 'main',
        path: FILE,
        limit: 10,
      });

      expect(page.commits.map((commit) => commit.oid)).toEqual([oids[4], oids[2], oids[0]]);
      expect(page.nextCursor).toBeNull();
    });

    it('summarizes a commit without a web link', async () => {
      const {connection, externalRepositoryId, oids} = await seedHistory();

      const page = await provider.listCommits({
        connection,
        externalRepositoryId,
        ref: oids[0] as string,
        path: FILE,
        limit: 1,
      });

      expect(page.commits).toEqual([
        {
          oid: oids[0],
          message: 'Add triage',
          authorName: 'Ada',
          authoredAt: new Date(1_790_000_000 * 1000),
        },
      ]);
    });

    it('keeps the commits that changed a folder', async () => {
      const {connection, externalRepositoryId, oids} = await seedHistory();

      const page = await provider.listCommits({
        connection,
        externalRepositoryId,
        ref: 'main',
        path: '.shipfox',
        limit: 10,
      });

      expect(page.commits.map((commit) => commit.oid)).toEqual([
        oids[4],
        oids[3],
        oids[2],
        oids[0],
      ]);
    });

    it('pages from the next commit, and ends on the last commit that changed the path', async () => {
      const {connection, externalRepositoryId, oids} = await seedHistory();
      const list = {connection, externalRepositoryId, ref: 'main', path: FILE, limit: 2};

      const first = await provider.listCommits(list);
      const second = await provider.listCommits({
        ...list,
        cursor: first.nextCursor ?? undefined,
      });

      expect(first.commits.map((commit) => commit.oid)).toEqual([oids[4], oids[2]]);
      expect(second.commits.map((commit) => commit.oid)).toEqual([oids[0]]);
      expect(second.nextCursor).toBeNull();
    });

    it('refuses a cursor from another branch', async () => {
      const {id, connection, externalRepositoryId, oids} = await seedHistory();
      await seedCommits({
        repositoryId: id,
        branch: 'shipfox/other',
        parent: oids[0],
        files: new Map([[FILE, 'v1']]),
        commits: [
          {message: 'First on the branch', files: [{path: FILE, content: 'a'}]},
          {message: 'Second on the branch', files: [{path: FILE, content: 'b'}]},
        ],
      });
      const other = await provider.listCommits({
        connection,
        externalRepositoryId,
        ref: 'shipfox/other',
        path: FILE,
        limit: 1,
      });

      const reason = await reasonOf(
        provider.listCommits({
          connection,
          externalRepositoryId,
          ref: 'main',
          path: FILE,
          limit: 1,
          cursor: other.nextCursor ?? undefined,
        }),
      );

      expect(reason).toBe('provider-rejected');
    });

    it('refuses a cursor after its branch moves, and continues from the pinned head', async () => {
      const {id, connection, externalRepositoryId, oids} = await seedHistory();
      const head = oids[4] as string;
      const list = {connection, externalRepositoryId, path: FILE, limit: 1};
      const first = await provider.listCommits({...list, ref: head});
      const cursor = first.nextCursor ?? undefined;
      await seedCommits({
        repositoryId: id,
        parent: head,
        commits: [{message: 'Moves main', files: [{path: 'README.md', content: 'moved'}]}],
      });

      const moved = await reasonOf(provider.listCommits({...list, ref: 'main', cursor}));
      const pinned = await provider.listCommits({...list, ref: head, cursor});

      expect(moved).toBe('provider-rejected');
      expect(pinned.commits.map((commit) => commit.oid)).toEqual([oids[2]]);
    });

    it('hands back a cursor when the scan budget runs out', async () => {
      const {connection, externalRepositoryId, oids} = await seedHistory();
      const budgeted = new ManagedSourceControlProvider({maxCommitsScanned: 2});
      const list = {connection, externalRepositoryId, ref: 'main', path: FILE, limit: 10};

      const first = await budgeted.listCommits(list);
      const second = await budgeted.listCommits({...list, cursor: first.nextCursor ?? undefined});
      const third = await budgeted.listCommits({...list, cursor: second.nextCursor ?? undefined});

      expect(first.commits.map((commit) => commit.oid)).toEqual([oids[4]]);
      expect(second.commits.map((commit) => commit.oid)).toEqual([oids[2]]);
      expect(third.commits.map((commit) => commit.oid)).toEqual([oids[0]]);
      expect(third.nextCursor).toBeNull();
    });

    it('moves the cursor forward with no scan budget', async () => {
      const {connection, externalRepositoryId, oids} = await seedHistory();
      const budgeted = new ManagedSourceControlProvider({maxCommitsScanned: 0});

      const page = await budgeted.listCommits({
        connection,
        externalRepositoryId,
        ref: 'main',
        path: FILE,
        limit: 10,
      });

      expect(page.commits.map((commit) => commit.oid)).toEqual([oids[4]]);
      expect(page.nextCursor).toContain(oids[3]);
    });

    it('moves the cursor forward with a limit of zero', async () => {
      const {connection, externalRepositoryId, oids} = await seedHistory();

      const page = await provider.listCommits({
        connection,
        externalRepositoryId,
        ref: 'main',
        path: FILE,
        limit: 0,
      });

      expect(page.nextCursor).toContain(oids[3]);
    });

    it('keeps a commit that only changes the mode of a path', async () => {
      const {id, connection, externalRepositoryId} = await createRepositoryRow();
      const oids = await seedCommits({
        repositoryId: id,
        commits: [
          {files: [{path: 'entry', content: 'target'}]},
          {files: [{path: 'entry', content: {symlink: 'target'}}]},
        ],
      });

      const page = await provider.listCommits({
        connection,
        externalRepositoryId,
        ref: 'main',
        path: 'entry',
        limit: 10,
      });

      expect(page.commits.map((commit) => commit.oid)).toEqual([oids[1], oids[0]]);
    });

    it('can return an empty page that still has a cursor', async () => {
      const {connection, externalRepositoryId} = await seedHistory();
      const budgeted = new ManagedSourceControlProvider({maxCommitsScanned: 1});

      const page = await budgeted.listCommits({
        connection,
        externalRepositoryId,
        ref: 'main',
        path: '.shipfox/workflows/other.yml',
        limit: 10,
      });

      expect(page.commits).toEqual([]);
      expect(page.nextCursor).not.toBeNull();
    });

    it('skips a commit that changes nothing', async () => {
      const {id, connection, externalRepositoryId} = await createRepositoryRow();
      const oids = await seedCommits({
        repositoryId: id,
        commits: [{files: [{path: FILE, content: 'v1'}]}, {message: 'Empty'}],
      });

      const page = await provider.listCommits({
        connection,
        externalRepositoryId,
        ref: 'main',
        path: FILE,
        limit: 10,
      });

      expect(page.commits.map((commit) => commit.oid)).toEqual([oids[0]]);
    });

    it('follows the first parent through a merge', async () => {
      const repository = await createRepositoryRow();
      const {id, connection, externalRepositoryId} = repository;
      const [base] = await seedCommits({
        repositoryId: id,
        commits: [{message: 'Base', files: [{path: FILE, content: 'v1'}]}],
      });
      const [branchCommit] = await seedCommits({
        repositoryId: id,
        branch: 'shipfox/change',
        parent: base as string,
        files: new Map([[FILE, 'v1']]),
        commits: [{message: 'On a branch', files: [{path: FILE, content: 'v2'}]}],
      });
      const [merge] = await seedCommits({
        repositoryId: id,
        parent: base as string,
        files: new Map([[FILE, 'v2']]),
        commits: [{message: 'Merge', extraParents: [branchCommit as string]}],
      });

      const page = await provider.listCommits({
        connection,
        externalRepositoryId,
        ref: 'main',
        path: FILE,
        limit: 10,
      });

      expect(page.commits.map((commit) => commit.oid)).toEqual([merge, base]);
    });

    it('lists nothing for a path that never existed', async () => {
      const {connection, externalRepositoryId} = await seedHistory();

      const page = await provider.listCommits({
        connection,
        externalRepositoryId,
        ref: 'main',
        path: '.shipfox/missing.yml',
        limit: 10,
      });

      expect(page).toEqual({commits: [], nextCursor: null});
    });

    it.each([
      ['a path', () => '../../../etc/passwd'],
      ['a head with no next commit', (head: string) => head],
      ['a malformed next commit', (head: string) => `${head}:not-an-id`],
      ['an empty next commit', (head: string) => `${head}:`],
      ['a commit that does not exist', (head: string) => `${head}:${'a'.repeat(40)}`],
    ])('refuses a cursor that is %s, with no corruption report', async (_, cursor) => {
      const {connection, externalRepositoryId, oids} = await seedHistory();

      const reason = await reasonOf(
        provider.listCommits({
          connection,
          externalRepositoryId,
          ref: 'main',
          path: FILE,
          limit: 10,
          cursor: cursor(oids[4] as string),
        }),
      );

      expect(reason).toBe('provider-rejected');
      expect(reportError).not.toHaveBeenCalled();
    });
  });

  describe('corruption', () => {
    async function seedAndKeepOnlyCommit() {
      const repository = await createRepositoryRow();
      const [commit] = await seedCommits({
        repositoryId: repository.id,
        commits: [{files: [{path: FILE, content: 'on: push'}]}],
      });
      return {
        ...repository,
        otherObjects: and(
          eq(managedObjects.repositoryId, repository.id),
          ne(managedObjects.oid, commit as string),
        ),
      };
    }

    afterEach(() => {
      vi.mocked(reportError).mockClear();
    });

    it('reports a tree that went missing under a commit', async () => {
      const {connection, externalRepositoryId, otherObjects} = await seedAndKeepOnlyCommit();
      await db().delete(managedObjects).where(otherObjects);

      const reason = await reasonOf(
        provider.fetchFile({connection, externalRepositoryId, ref: 'main', path: FILE}),
      );

      expect(reason).toBe('provider-unavailable');
      expect(reportError).toHaveBeenCalledOnce();
    });

    it('reports object bytes that cannot be read', async () => {
      const {connection, externalRepositoryId, otherObjects} = await seedAndKeepOnlyCommit();
      await db()
        .update(managedObjects)
        .set({data: Buffer.from('not deflated')})
        .where(otherObjects);

      const reason = await reasonOf(
        provider.fetchFile({connection, externalRepositoryId, ref: 'main', path: FILE}),
      );

      expect(reason).toBe('provider-unavailable');
      expect(reportError).toHaveBeenCalledOnce();
    });
  });

  describe('storage', () => {
    it("refuses a ref to a commit the repository doesn't hold", async () => {
      const other = await createRepositoryRow();
      const [foreignCommit] = await seedCommits({repositoryId: other.id, commits: [{files: []}]});
      const {id} = await createRepositoryRow();

      const insert = db()
        .insert(managedRefs)
        .values({repositoryId: id, name: 'refs/heads/main', commitOid: foreignCommit as string});

      await expect(insert).rejects.toMatchObject({
        cause: {constraint: 'integrations_managed_refs_commit_fk'},
      });
    });

    it('removes refs and objects with the repository', async () => {
      const {id} = await createRepositoryRow();
      await seedCommits({
        repositoryId: id,
        commits: [{files: [{path: FILE, content: 'on: push'}]}],
      });

      await db().delete(managedRepositories).where(eq(managedRepositories.id, id));

      const objects = await db()
        .select()
        .from(managedObjects)
        .where(eq(managedObjects.repositoryId, id));
      const refs = await db()
        .select()
        .from(managedRefs)
        .where(and(eq(managedRefs.repositoryId, id), eq(managedRefs.name, 'refs/heads/main')));
      expect(objects).toEqual([]);
      expect(refs).toEqual([]);
    });
  });
});
