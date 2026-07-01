import crypto from 'node:crypto';
import {beforeEach, describe, expect, it} from '@shipfox/vitest/vi';
import {eq} from 'drizzle-orm';
import {db, secretDataKeys, secretValues, updateDataKeyWrapCas} from '#db/index.js';
import {DekManager} from './dek-manager.js';
import {KekVersionStrandedError} from './errors.js';
import {createLocalKeyProvider} from './key-provider.js';
import {createLocalSecretStore} from './local-secret-store.js';
import {rotateWorkspaceDataKeysWithProvider} from './rotate-kek.js';
import {encryptSecretValue} from './value-cipher.js';

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

  it('preserves value decryption after rewrapping the data key', async () => {
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
    await db()
      .insert(secretValues)
      .values({
        workspaceId,
        projectId: null,
        namespace: '',
        key: 'TOKEN',
        ciphertext: encryptSecretValue({
          dek,
          workspaceId,
          scope: {projectId: null},
          namespace: '',
          key: 'TOKEN',
          value: 'still-readable',
        }),
      });

    await rotateWorkspaceDataKeysWithProvider(currentProvider);
    const localStore = createLocalSecretStore({
      dekManager: new DekManager(currentProvider, {maxEntries: 10, ttlMs: 60_000}),
    });
    const value = await localStore.getSecret({workspaceId, namespace: '', key: 'TOKEN'});

    expect(value).toBe('still-readable');
  });

  it('is idempotent after rotating and is a no-op over an empty key set', async () => {
    const emptyResult = await rotateWorkspaceDataKeysWithProvider(
      createLocalKeyProvider({currentKek: crypto.randomBytes(32)}),
    );

    const workspaceId = crypto.randomUUID();
    const currentKek = crypto.randomBytes(32);
    const previousKek = crypto.randomBytes(32);
    const currentProvider = createLocalKeyProvider({currentKek, previousKek});
    const previousProvider = createLocalKeyProvider({currentKek: previousKek});
    const previousWrapped = previousProvider.wrapDek(workspaceId, crypto.randomBytes(32));
    await db().insert(secretDataKeys).values({
      workspaceId,
      wrappedDek: previousWrapped.wrappedDek,
      kekVersion: previousWrapped.kekVersion,
    });

    const first = await rotateWorkspaceDataKeysWithProvider(currentProvider);
    const second = await rotateWorkspaceDataKeysWithProvider(currentProvider);

    expect(emptyResult).toEqual({rotated: 0, skipped: 0});
    expect(first.rotated).toBe(1);
    expect(second).toEqual({rotated: 0, skipped: 1});
  });

  it('does not clobber a data key after a concurrent rotation wins', async () => {
    const workspaceId = crypto.randomUUID();
    const currentProvider = createLocalKeyProvider({currentKek: crypto.randomBytes(32)});
    const oldProvider = createLocalKeyProvider({currentKek: crypto.randomBytes(32)});
    const oldWrapped = oldProvider.wrapDek(workspaceId, crypto.randomBytes(32));
    const freshWrapped = currentProvider.wrapDek(workspaceId, crypto.randomBytes(32));
    await db().insert(secretDataKeys).values({
      workspaceId,
      wrappedDek: freshWrapped.wrappedDek,
      kekVersion: freshWrapped.kekVersion,
    });

    const updated = await updateDataKeyWrapCas({
      workspaceId,
      oldKekVersion: oldWrapped.kekVersion,
      wrappedDek: oldWrapped.wrappedDek,
      kekVersion: oldWrapped.kekVersion,
    });
    const rows = await db()
      .select()
      .from(secretDataKeys)
      .where(eq(secretDataKeys.workspaceId, workspaceId));

    expect(updated).toBe(false);
    expect(rows[0]?.wrappedDek).toBe(freshWrapped.wrappedDek);
    expect(rows[0]?.kekVersion).toBe(freshWrapped.kekVersion);
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
