import crypto from 'node:crypto';
import {describe, expect, it} from '@shipfox/vitest/vi';
import {eq} from 'drizzle-orm';
import {db, secretDataKeys} from '#db/index.js';
import {DekManager} from './dek-manager.js';
import {createLocalKeyProvider} from './key-provider.js';

describe('DekManager', () => {
  it('persists one data key across concurrent first use', async () => {
    const workspaceId = crypto.randomUUID();
    const manager = new DekManager(createLocalKeyProvider({currentKek: crypto.randomBytes(32)}), {
      maxEntries: 10,
      ttlMs: 60_000,
    });

    const [first, second] = await Promise.all([
      manager.getPlaintextDek(workspaceId),
      manager.getPlaintextDek(workspaceId),
    ]);
    const rows = await db()
      .select()
      .from(secretDataKeys)
      .where(eq(secretDataKeys.workspaceId, workspaceId));

    expect(rows).toHaveLength(1);
    expect(first.equals(second)).toBe(true);
  });

  it('re-reads persisted data keys on cold start', async () => {
    const workspaceId = crypto.randomUUID();
    const keyProvider = createLocalKeyProvider({currentKek: crypto.randomBytes(32)});
    const firstManager = new DekManager(keyProvider, {maxEntries: 10, ttlMs: 60_000});
    const secondManager = new DekManager(keyProvider, {maxEntries: 10, ttlMs: 60_000});

    const first = await firstManager.getPlaintextDek(workspaceId);
    const second = await secondManager.getPlaintextDek(workspaceId);

    expect(second.equals(first)).toBe(true);
  });

  it('serves cache hits without reading the persisted data key', async () => {
    const workspaceId = crypto.randomUUID();
    const manager = new DekManager(createLocalKeyProvider({currentKek: crypto.randomBytes(32)}), {
      maxEntries: 10,
      ttlMs: 60_000,
    });

    const first = await manager.getPlaintextDek(workspaceId);
    await db().delete(secretDataKeys).where(eq(secretDataKeys.workspaceId, workspaceId));
    const second = await manager.getPlaintextDek(workspaceId);

    expect(second.equals(first)).toBe(true);
  });

  it('returns defensive copies of cached data keys', async () => {
    const workspaceId = crypto.randomUUID();
    const manager = new DekManager(createLocalKeyProvider({currentKek: crypto.randomBytes(32)}), {
      maxEntries: 10,
      ttlMs: 60_000,
    });

    const first = await manager.getPlaintextDek(workspaceId);
    const expected = Buffer.from(first);
    first.fill(0);
    const second = await manager.getPlaintextDek(workspaceId);

    expect(second.equals(expected)).toBe(true);
  });

  it('refreshes expired cache entries from storage', async () => {
    const workspaceId = crypto.randomUUID();
    const manager = new DekManager(createLocalKeyProvider({currentKek: crypto.randomBytes(32)}), {
      maxEntries: 10,
      ttlMs: -1,
    });

    const first = await manager.getPlaintextDek(workspaceId);
    await db().delete(secretDataKeys).where(eq(secretDataKeys.workspaceId, workspaceId));
    const second = await manager.getPlaintextDek(workspaceId);

    expect(second.equals(first)).toBe(false);
  });

  it('evicts the least recently used cache entry when full', async () => {
    const evictedWorkspaceId = crypto.randomUUID();
    const otherWorkspaceId = crypto.randomUUID();
    const manager = new DekManager(createLocalKeyProvider({currentKek: crypto.randomBytes(32)}), {
      maxEntries: 1,
      ttlMs: 60_000,
    });

    const first = await manager.getPlaintextDek(evictedWorkspaceId);
    await manager.getPlaintextDek(otherWorkspaceId);
    await db().delete(secretDataKeys).where(eq(secretDataKeys.workspaceId, evictedWorkspaceId));
    const second = await manager.getPlaintextDek(evictedWorkspaceId);

    expect(second.equals(first)).toBe(false);
  });
});
