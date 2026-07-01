import {listDataKeysPage, listDataKeyVersions, updateDataKeyWrapCas} from '#db/index.js';
import {KekVersionStrandedError} from './errors.js';
import type {KeyProvider} from './key-provider.js';

const PAGE_SIZE = 100;

export interface RotateWorkspaceDataKeysResult {
  rotated: number;
  skipped: number;
}

export async function rotateWorkspaceDataKeysWithProvider(
  keyProvider: KeyProvider,
): Promise<RotateWorkspaceDataKeysResult> {
  const knownVersions = [keyProvider.currentKeyVersion, keyProvider.previousKeyVersion].filter(
    (version): version is string => Boolean(version),
  );
  const unknownVersions = await listDataKeyVersions(knownVersions);
  if (unknownVersions.length > 0) throw new KekVersionStrandedError(unknownVersions[0] as string);

  let rotated = 0;
  let skipped = 0;
  let afterWorkspaceId: string | undefined;

  while (true) {
    const page = await listDataKeysPage({afterWorkspaceId, limit: PAGE_SIZE});
    if (page.length === 0) break;

    for (const row of page) {
      afterWorkspaceId = row.workspaceId;
      if (row.kekVersion === keyProvider.currentKeyVersion) {
        skipped += 1;
        continue;
      }

      const plaintextDek = keyProvider.unwrapDek(row.workspaceId, row.wrappedDek, row.kekVersion);
      try {
        const wrapped = keyProvider.wrapDek(row.workspaceId, plaintextDek);
        const updated = await updateDataKeyWrapCas({
          workspaceId: row.workspaceId,
          oldKekVersion: row.kekVersion,
          wrappedDek: wrapped.wrappedDek,
          kekVersion: wrapped.kekVersion,
        });
        if (updated) rotated += 1;
        else skipped += 1;
      } finally {
        plaintextDek.fill(0);
      }
    }
  }

  return {rotated, skipped};
}
