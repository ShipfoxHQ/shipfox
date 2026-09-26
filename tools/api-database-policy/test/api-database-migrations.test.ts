import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {promisify} from 'node:util';
import {
  auditMigrationHistory,
  type MigrationFileChange,
  verifyMigrationHistory,
} from '../src/api-database-migrations.js';

const execFileAsync = promisify(execFile);
const migrations = 'libs/api/runners/drizzle';
const firstEntry = {idx: 0, version: '7', when: 1_000, tag: '0000_initial', breakpoints: true};
const secondEntry = {idx: 1, version: '7', when: 2_000, tag: '0001_next', breakpoints: true};

function journal(...entries: object[]): string {
  return JSON.stringify({version: '7', dialect: 'postgresql', entries}, null, 2);
}

function rules(changes: MigrationFileChange[]): string[] {
  return auditMigrationHistory(changes).map((finding) => `${finding.rule} ${finding.file}`);
}

describe('migration history verifier', () => {
  test('accepts a new migration with its journal entry and snapshot', () => {
    assert.deepEqual(
      rules([
        {path: `${migrations}/0001_next.sql`, after: 'CREATE TABLE runners_next ();'},
        {path: `${migrations}/meta/0001_snapshot.json`, after: '{}'},
        {
          path: `${migrations}/meta/_journal.json`,
          before: journal(firstEntry),
          after: journal(firstEntry, secondEntry),
        },
      ]),
      [],
    );
  });

  test('rejects an edited migration', () => {
    assert.deepEqual(
      rules([
        {
          path: `${migrations}/0000_initial.sql`,
          before: 'CREATE TABLE runners_a ();',
          after: 'CREATE TABLE runners_b ();',
        },
      ]),
      [`changed-migration ${migrations}/0000_initial.sql`],
    );
  });

  test('rejects a deleted or renamed migration', () => {
    assert.deepEqual(
      rules([
        {path: `${migrations}/0000_initial.sql`, before: 'CREATE TABLE runners_a ();'},
        {path: `${migrations}/0000_renamed.sql`, after: 'CREATE TABLE runners_a ();'},
      ]),
      [`removed-migration ${migrations}/0000_initial.sql`],
    );
  });

  test('rejects rewritten and removed journal entries', () => {
    assert.deepEqual(
      rules([
        {
          path: `${migrations}/meta/_journal.json`,
          before: journal(firstEntry, secondEntry),
          after: journal({...firstEntry, when: 3_000}),
        },
      ]),
      [
        `changed-journal-entry ${migrations}/meta/_journal.json`,
        `removed-journal-entry ${migrations}/meta/_journal.json`,
      ],
    );
  });

  test('rejects a deleted journal', () => {
    assert.deepEqual(
      rules([{path: `${migrations}/meta/_journal.json`, before: journal(firstEntry)}]),
      [`removed-journal-entry ${migrations}/meta/_journal.json`],
    );
  });

  test('accepts a changed snapshot only alongside a new migration in the same folder', () => {
    const snapshot = {
      path: `${migrations}/meta/0000_snapshot.json`,
      before: '{}',
      after: '{"a":1}',
    };

    assert.deepEqual(rules([snapshot]), [`changed-snapshot ${snapshot.path}`]);
    assert.deepEqual(
      rules([snapshot, {path: 'libs/api/logs/drizzle/0001_next.sql', after: 'SELECT 1;'}]),
      [`changed-snapshot ${snapshot.path}`],
    );
    assert.deepEqual(
      rules([snapshot, {path: `${migrations}/0001_next.sql`, after: 'SELECT 1;'}]),
      [],
    );
  });

  test('checks nested migration folders', () => {
    const file = 'libs/api/integration/github/drizzle/0000_initial.sql';

    assert.deepEqual(rules([{path: file, before: 'SELECT 1;', after: 'SELECT 2;'}]), [
      `changed-migration ${file}`,
    ]);
  });

  describe('against a git repository', () => {
    let root: string;

    async function git(...args: string[]): Promise<void> {
      await execFileAsync('git', args, {cwd: root});
    }

    async function write(file: string, content: string): Promise<void> {
      await mkdir(dirname(join(root, file)), {recursive: true});
      await writeFile(join(root, file), content);
    }

    beforeEach(async () => {
      root = await mkdtemp(join(tmpdir(), 'api-database-migrations-'));
      await git('init', '--quiet', '--initial-branch=main');
      await write(`${migrations}/0000_initial.sql`, 'CREATE TABLE runners_a ();\n');
      await write(`${migrations}/meta/_journal.json`, journal(firstEntry));
      await write(`${migrations}/meta/0000_snapshot.json`, '{}');
      await git('add', '.');
      await git(
        '-c',
        'user.name=test',
        '-c',
        'user.email=test@example.com',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--no-verify',
        '-qm',
        'base',
      );
      await git('checkout', '--quiet', '-b', 'feature');
    });

    afterEach(async () => {
      await rm(root, {recursive: true, force: true});
    });

    test('accepts a snapshot change alongside an untracked new migration', async () => {
      await write(`${migrations}/0001_next.sql`, 'CREATE TABLE runners_b ();\n');
      await write(`${migrations}/meta/_journal.json`, journal(firstEntry, secondEntry));
      await write(`${migrations}/meta/0000_snapshot.json`, '{"a":1}');

      assert.deepEqual(
        await verifyMigrationHistory({rootDirectory: root, baseRevision: 'main'}),
        [],
      );
    });

    test('rejects an edit to a migration from the base revision', async () => {
      await write(`${migrations}/0000_initial.sql`, 'CREATE TABLE runners_b ();\n');

      const findings = await verifyMigrationHistory({rootDirectory: root, baseRevision: 'main'});

      assert.deepEqual(
        findings.map((finding) => finding.rule),
        ['changed-migration'],
      );
    });

    test('rejects a deleted migration from the base revision', async () => {
      await rm(join(root, `${migrations}/0000_initial.sql`));

      const findings = await verifyMigrationHistory({rootDirectory: root, baseRevision: 'main'});

      assert.deepEqual(
        findings.map((finding) => finding.rule),
        ['removed-migration'],
      );
    });
  });
});
