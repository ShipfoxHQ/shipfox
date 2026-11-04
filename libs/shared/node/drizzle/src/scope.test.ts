import {randomUUID} from 'node:crypto';
import type {Pool} from '@shipfox/node-postgres';
import {and, eq, sql} from 'drizzle-orm';
import {drizzle} from 'drizzle-orm/node-postgres';
import {integer, pgTable, uuid} from 'drizzle-orm/pg-core';
import {withFreshDatabase} from '#test/fresh-database.js';
import {
  assertScopeWritable,
  deletedScopeColumns,
  deleteInBatches,
  recordDeletedScope,
  ScopeDeletedError,
} from './scope.js';

const deletedScopes = pgTable('scope_test_deleted_scopes', deletedScopeColumns());
const rows = pgTable('scope_test_rows', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  projectId: uuid('project_id').notNull(),
});

async function createTables(database: ReturnType<typeof drizzle>): Promise<void> {
  await database.execute(sql`
    create table scope_test_deleted_scopes (
      workspace_id uuid not null,
      project_id uuid,
      reason text not null,
      recorded_at timestamptz not null default now(),
      purged_at timestamptz,
      constraint scope_test_deleted_scopes_unique unique nulls not distinct (workspace_id, project_id)
    )`);
  await database.execute(sql`
    create table scope_test_rows (
      id integer primary key generated always as identity,
      project_id uuid not null
    )`);
}

// The marker is blocked once PostgreSQL lists an advisory lock request it has not granted.
async function waitForBlockedLock(pool: Pool): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const {rows} = await pool.query(
      "select 1 from pg_locks where locktype = 'advisory' and not granted",
    );
    if (rows.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('The marker never waited for the write lock');
}

describe('deleted scope markers', () => {
  it('lets a write through a scope with no marker', async () => {
    await withFreshDatabase(async (pool) => {
      const database = drizzle(pool);
      await createTables(database);

      await expect(
        database.transaction((tx) =>
          assertScopeWritable(tx, deletedScopes, {
            workspaceId: randomUUID(),
            projectId: randomUUID(),
          }),
        ),
      ).resolves.toBeUndefined();
    });
  });

  it('refuses writes to a deleted project and leaves its siblings writable', async () => {
    await withFreshDatabase(async (pool) => {
      const database = drizzle(pool);
      await createTables(database);
      const workspaceId = randomUUID();
      const deletedProjectId = randomUUID();
      const siblingProjectId = randomUUID();

      await database.transaction((tx) =>
        recordDeletedScope(tx, deletedScopes, {
          scope: {workspaceId, projectId: deletedProjectId},
          reason: 'project_deleted',
        }),
      );

      const refused = database.transaction((tx) =>
        assertScopeWritable(tx, deletedScopes, {workspaceId, projectId: deletedProjectId}),
      );
      await expect(refused).rejects.toBeInstanceOf(ScopeDeletedError);
      await expect(refused).rejects.toMatchObject({
        scope: {workspaceId, projectId: deletedProjectId},
      });
      await expect(
        database.transaction((tx) =>
          assertScopeWritable(tx, deletedScopes, {workspaceId, projectId: siblingProjectId}),
        ),
      ).resolves.toBeUndefined();
      await expect(
        database.transaction((tx) => assertScopeWritable(tx, deletedScopes, {workspaceId})),
      ).resolves.toBeUndefined();
    });
  });

  it('refuses every write of a deleted workspace', async () => {
    await withFreshDatabase(async (pool) => {
      const database = drizzle(pool);
      await createTables(database);
      const workspaceId = randomUUID();
      await database.transaction((tx) =>
        recordDeletedScope(tx, deletedScopes, {
          scope: {workspaceId},
          reason: 'workspace_deleted',
        }),
      );

      await expect(
        database.transaction((tx) =>
          assertScopeWritable(tx, deletedScopes, {workspaceId, projectId: randomUUID()}),
        ),
      ).rejects.toBeInstanceOf(ScopeDeletedError);
      await expect(
        database.transaction((tx) => assertScopeWritable(tx, deletedScopes, {workspaceId})),
      ).rejects.toBeInstanceOf(ScopeDeletedError);
    });
  });

  it('keeps the first marker when a scope is recorded twice', async () => {
    await withFreshDatabase(async (pool) => {
      const database = drizzle(pool);
      await createTables(database);
      const scope = {workspaceId: randomUUID(), projectId: randomUUID()};

      await database.transaction((tx) =>
        recordDeletedScope(tx, deletedScopes, {scope, reason: 'first'}),
      );
      await database.transaction((tx) =>
        recordDeletedScope(tx, deletedScopes, {scope, reason: 'second'}),
      );

      const markers = await database
        .select()
        .from(deletedScopes)
        .where(
          and(
            eq(deletedScopes.workspaceId, scope.workspaceId),
            eq(deletedScopes.projectId, scope.projectId),
          ),
        );
      expect(markers).toHaveLength(1);
      expect(markers[0]?.reason).toBe('first');
    });
  });

  it('waits for a write in progress, then refuses the writes after it', async () => {
    await withFreshDatabase(async (pool) => {
      const database = drizzle(pool);
      await createTables(database);
      const scope = {workspaceId: randomUUID(), projectId: randomUUID()};
      const events: string[] = [];
      let finishWrite: () => void = () => undefined;
      const writeMayFinish = new Promise<void>((resolve) => {
        finishWrite = resolve;
      });
      let writeHoldsLock: () => void = () => undefined;
      const writeStarted = new Promise<void>((resolve) => {
        writeHoldsLock = resolve;
      });

      const write = database.transaction(async (tx) => {
        await assertScopeWritable(tx, deletedScopes, scope);
        writeHoldsLock();
        await writeMayFinish;
        await tx.insert(rows).values({projectId: scope.projectId});
        events.push('write committed');
      });
      await writeStarted;

      const marker = database.transaction(async (tx) => {
        await recordDeletedScope(tx, deletedScopes, {scope, reason: 'project_deleted'});
        events.push('marker recorded');
      });
      await waitForBlockedLock(pool);
      expect(events).toEqual([]);

      finishWrite();
      await Promise.all([write, marker]);
      expect(events).toEqual(['write committed', 'marker recorded']);
      await expect(
        database.transaction((tx) => assertScopeWritable(tx, deletedScopes, scope)),
      ).rejects.toBeInstanceOf(ScopeDeletedError);
    });
  });
});

describe('deleteInBatches', () => {
  it('deletes every matching row across several batches and leaves the others', async () => {
    await withFreshDatabase(async (pool) => {
      const database = drizzle(pool);
      await createTables(database);
      const target = randomUUID();
      const other = randomUUID();
      await database
        .insert(rows)
        .values([
          ...Array.from({length: 25}, () => ({projectId: target})),
          ...Array.from({length: 3}, () => ({projectId: other})),
        ]);

      const deleted = await deleteInBatches({
        db: database,
        table: rows,
        where: eq(rows.projectId, target),
        batchSize: 10,
      });

      expect(deleted).toBe(25);
      const remaining = await database.select().from(rows);
      expect(remaining).toHaveLength(3);
      expect(remaining.every((row) => row.projectId === other)).toBe(true);
    });
  });

  it('deletes nothing when no row matches', async () => {
    await withFreshDatabase(async (pool) => {
      const database = drizzle(pool);
      await createTables(database);

      const deleted = await deleteInBatches({
        db: database,
        table: rows,
        where: eq(rows.projectId, randomUUID()),
        batchSize: 10,
      });

      expect(deleted).toBe(0);
    });
  });

  it('rejects a batch size that is not a positive integer', async () => {
    await withFreshDatabase(async (pool) => {
      const database = drizzle(pool);

      await expect(
        deleteInBatches({db: database, table: rows, where: undefined, batchSize: 0}),
      ).rejects.toThrow(RangeError);
    });
  });
});
