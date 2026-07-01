import crypto from 'node:crypto';
import {beforeEach, describe, expect, it} from '@shipfox/vitest/vi';
import {eq} from 'drizzle-orm';
import {db, secretDataKeys} from '#db/index.js';
import {KekVersionStrandedError} from './errors.js';
import {createLocalKeyProvider} from './key-provider.js';
import {rotateWorkspaceDataKeysWithProvider} from './rotate-kek.js';

describe('rotateWorkspaceDataKeysWithProvider', () => {
  beforeEach(async () => {
    await db().delete(secretDataKeys);
  });

  it('rewraps previous-version data keys under the current KEK', async () => {
    const workspaceId = crypto.randomUUID();
    const currentKek = crypto.randomBytes(32);
    const previousKek = crypto.randomBytes(32);
    const currentProvider = createLocalKeyProvider({currentKek, previousKek});
    const previousProvider = createLocalKeyProvider({currentKek: previousKek});
    const dek = crypto.randomBytes(32);
    const previousWrapped = previousProvider.wrapDek(workspaceId, dek);
    await db().insert(secretDataKeys).values({
      workspaceId,
      wrappedDek: previousWrapped.wrappedDek,
      kekVersion: previousWrapped.kekVersion,
    });

    const result = await rotateWorkspaceDataKeysWithProvider(currentProvider);
    const rows = await db()
      .select()
      .from(secretDataKeys)
      .where(eq(secretDataKeys.workspaceId, workspaceId));
    const row = rows[0];
    if (!row) throw new Error('Expected rotated row');
    const unwrapped = currentProvider.unwrapDek(row.workspaceId, row.wrappedDek, row.kekVersion);

    expect(result.rotated).toBeGreaterThanOrEqual(1);
    expect(row.kekVersion).toBe(currentProvider.currentKeyVersion);
    expect(row.wrappedDek).not.toBe(previousWrapped.wrappedDek);
    expect(row.rotatedAt).toBeInstanceOf(Date);
    expect(unwrapped.equals(dek)).toBe(true);
  });

  it('fails loud when any data key version is stranded', async () => {
    const workspaceId = crypto.randomUUID();
    await db().insert(secretDataKeys).values({
      workspaceId,
      wrappedDek: 'v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      kekVersion: 'local:stranded',
    });

    await expect(
      rotateWorkspaceDataKeysWithProvider(
        createLocalKeyProvider({currentKek: crypto.randomBytes(32)}),
      ),
    ).rejects.toThrow(KekVersionStrandedError);
  });
});
