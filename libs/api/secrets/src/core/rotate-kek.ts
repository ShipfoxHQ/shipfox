import {listDataKeysPage, listDataKeyVersions, updateDataKeyWrapCas} from '#db/index.js';
import {classifyKekRotationError, recordSecretsKekRotation} from '#metrics/instance.js';
import {KekVersionStrandedError} from './errors.js';
import type {KeyProvider} from './key-provider.js';

const PAGE_SIZE = 100;

export interface RotateWorkspaceDataKeysResult {
  rotated: number;
  skipped: number;
}

export interface RotateWorkspaceDataKeysOptions {
  workspaceIds?: string[] | undefined;
}

export async function rotateWorkspaceDataKeysWithProvider(
  keyProvider: KeyProvider,
  options: RotateWorkspaceDataKeysOptions = {},
): Promise<RotateWorkspaceDataKeysResult> {
  const startedAt = Date.now();
  try {
    const knownVersions = [keyProvider.currentKeyVersion, keyProvider.previousKeyVersion].filter(
      (version): version is string => Boolean(version),
    );
    const unknownVersions = await listDataKeyVersions(knownVersions, {
      workspaceIds: options.workspaceIds,
    });
    if (unknownVersions.length > 0) throw new KekVersionStrandedError(unknownVersions[0] as string);

    let rotated = 0;
    let skipped = 0;
    let skippedCurrent = 0;
    let skippedRace = 0;
    let afterWorkspaceId: string | undefined;

    while (true) {
      const page = await listDataKeysPage({
        afterWorkspaceId,
        limit: PAGE_SIZE,
        workspaceIds: options.workspaceIds,
      });
      if (page.length === 0) break;

      for (const row of page) {
        afterWorkspaceId = row.workspaceId;
        if (row.kekVersion === keyProvider.currentKeyVersion) {
          skipped += 1;
          skippedCurrent += 1;
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
          else {
            skipped += 1;
            skippedRace += 1;
          }
        } finally {
          plaintextDek.fill(0);
        }
      }
    }

    recordSecretsKekRotation({outcome: 'rotated', count: rotated});
    recordSecretsKekRotation({outcome: 'skipped_current', count: skippedCurrent});
    recordSecretsKekRotation({outcome: 'skipped_race', count: skippedRace});
    recordSecretsKekRotation({
      outcome: rotationDurationOutcome({rotated, skippedCurrent, skippedRace}),
      count: 0,
      durationMs: Date.now() - startedAt,
    });
    return {rotated, skipped};
  } catch (error) {
    recordSecretsKekRotation({
      outcome: classifyKekRotationError(error),
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}

function rotationDurationOutcome(params: {
  rotated: number;
  skippedCurrent: number;
  skippedRace: number;
}) {
  if (params.rotated > 0) return 'rotated';
  if (params.skippedRace > 0) return 'skipped_race';
  if (params.skippedCurrent === 0) return 'none';
  return 'skipped_current';
}
