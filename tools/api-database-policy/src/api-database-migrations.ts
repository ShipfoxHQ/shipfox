import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual, promisify} from 'node:util';

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const defaultBaseRevision = 'origin/main';
const migrationPathspec = ':(glob)libs/api/**/drizzle/**';
const migrationFileExpression = /^libs\/api\/(?:[^/]+\/)+drizzle\/[^/]+\.sql$/u;
const journalFileExpression = /^libs\/api\/(?:[^/]+\/)+drizzle\/meta\/_journal\.json$/u;
const snapshotFileExpression = /^libs\/api\/(?:[^/]+\/)+drizzle\/meta\/[^/]+_snapshot\.json$/u;
const policyReference = 'docs/policies/database-boundaries.md#migrations-and-tests';

export type MigrationHistoryRule =
  | 'changed-journal-entry'
  | 'changed-migration'
  | 'changed-snapshot'
  | 'removed-journal-entry'
  | 'removed-migration';

export interface MigrationHistoryFinding {
  file: string;
  rule: MigrationHistoryRule;
  message: string;
}

// `before` is absent for an added file and `after` is absent for a removed one.
export interface MigrationFileChange {
  path: string;
  before?: string | undefined;
  after?: string | undefined;
}

interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
}

function migrationsDirectory(filePath: string): string {
  const directory = path.posix.dirname(filePath);
  return path.posix.basename(directory) === 'meta' ? path.posix.dirname(directory) : directory;
}

function journalEntries(file: string, source: string): JournalEntry[] {
  const journal = JSON.parse(source) as {entries?: unknown};
  if (!Array.isArray(journal.entries)) throw new Error(`${file} has no entries array`);
  return journal.entries as JournalEntry[];
}

function auditJournal(change: MigrationFileChange): MigrationHistoryFinding[] {
  if (change.before === undefined) return [];
  const before = journalEntries(change.path, change.before);
  const after = change.after === undefined ? [] : journalEntries(change.path, change.after);
  const findings: MigrationHistoryFinding[] = [];
  before.forEach((entry, index) => {
    const current = after[index];
    if (current === undefined) {
      findings.push({
        file: change.path,
        rule: 'removed-journal-entry',
        message: `journal entry ${entry.idx} (${entry.tag}) was removed`,
      });
    } else if (!isDeepStrictEqual(current, entry)) {
      findings.push({
        file: change.path,
        rule: 'changed-journal-entry',
        message: `journal entry ${entry.idx} (${entry.tag}) changed`,
      });
    }
  });
  return findings;
}

export function auditMigrationHistory(
  changes: readonly MigrationFileChange[],
): MigrationHistoryFinding[] {
  const directoriesWithNewMigrations = new Set(
    changes
      .filter((change) => change.before === undefined && migrationFileExpression.test(change.path))
      .map((change) => migrationsDirectory(change.path)),
  );
  const findings: MigrationHistoryFinding[] = [];
  for (const change of changes) {
    if (change.before === undefined || change.before === change.after) continue;
    if (migrationFileExpression.test(change.path)) {
      findings.push(
        change.after === undefined
          ? {
              file: change.path,
              rule: 'removed-migration',
              message: 'migration was deleted or renamed',
            }
          : {file: change.path, rule: 'changed-migration', message: 'migration was edited'},
      );
    } else if (journalFileExpression.test(change.path)) {
      findings.push(...auditJournal(change));
    } else if (
      snapshotFileExpression.test(change.path) &&
      !directoriesWithNewMigrations.has(migrationsDirectory(change.path))
    ) {
      findings.push({
        file: change.path,
        rule: 'changed-snapshot',
        message: 'snapshot changed or was removed without a new migration in the same folder',
      });
    }
  }
  return findings.sort((left, right) => left.file.localeCompare(right.file));
}

async function git(rootDirectory: string, args: string[]): Promise<string> {
  const {stdout} = await execFileAsync('git', args, {
    cwd: rootDirectory,
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

async function readCurrentFile(rootDirectory: string, file: string): Promise<string | undefined> {
  try {
    return await readFile(path.join(rootDirectory, file), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function nullSeparated(output: string): string[] {
  return output.split('\0').filter((entry) => entry.length > 0);
}

export async function readMigrationChanges(options: {
  rootDirectory: string;
  baseRevision: string;
}): Promise<MigrationFileChange[]> {
  const {rootDirectory, baseRevision} = options;
  let mergeBase: string;
  try {
    mergeBase = (await git(rootDirectory, ['merge-base', baseRevision, 'HEAD'])).trim();
  } catch {
    throw new Error(
      `Cannot find a merge base between ${baseRevision} and HEAD. Fetch the base revision with full history.`,
    );
  }
  // Compare the merge base with the working tree so uncommitted edits are checked locally.
  const status = nullSeparated(
    await git(rootDirectory, [
      'diff',
      '--no-renames',
      '--name-status',
      '-z',
      mergeBase,
      '--',
      migrationPathspec,
    ]),
  );
  const baseFiles = new Set<string>();
  const changed = new Set<string>();
  for (let index = 0; index + 1 < status.length; index += 2) {
    const file = status[index + 1] as string;
    changed.add(file);
    if (status[index] !== 'A') baseFiles.add(file);
  }
  const untracked = nullSeparated(
    await git(rootDirectory, [
      'ls-files',
      '--others',
      '--exclude-standard',
      '-z',
      '--',
      migrationPathspec,
    ]),
  );
  for (const file of untracked) changed.add(file);
  return Promise.all(
    [...changed].map(async (file) => ({
      path: file,
      before: baseFiles.has(file)
        ? await git(rootDirectory, ['show', `${mergeBase}:${file}`])
        : undefined,
      after: await readCurrentFile(rootDirectory, file),
    })),
  );
}

export async function verifyMigrationHistory(options: {
  rootDirectory?: string;
  baseRevision?: string;
}): Promise<MigrationHistoryFinding[]> {
  return auditMigrationHistory(
    await readMigrationChanges({
      rootDirectory: options.rootDirectory ?? repositoryRoot,
      baseRevision: options.baseRevision ?? defaultBaseRevision,
    }),
  );
}

async function main(): Promise<void> {
  const baseRevision = process.env.SHIPFOX_MIGRATION_BASE || defaultBaseRevision;
  const findings = await verifyMigrationHistory({baseRevision});
  if (findings.length === 0) {
    process.stdout.write(`API migration history verification passed against ${baseRevision}\n`);
    return;
  }
  process.stderr.write(`API migration history verification failed against ${baseRevision}\n`);
  for (const finding of findings)
    process.stderr.write(`- ${finding.file} ${finding.rule}: ${finding.message}\n`);
  process.stderr.write(
    `Migrations already on main can't change. Restore them and add a new migration instead. See ${policyReference}.\n`,
  );
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
