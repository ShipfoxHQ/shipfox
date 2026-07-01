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
});
