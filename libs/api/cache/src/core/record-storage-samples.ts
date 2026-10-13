import {MAX_STORAGE_SAMPLES_BATCH_SIZE, type StorageSampleInputDto} from '@shipfox/api-usage-dto';
import type {UsageModuleClient} from '@shipfox/api-usage-dto/inter-module';
import {sumReadyStorageByProject} from '#db/entries.js';

const HOUR_MS = 3_600_000;

export interface RecordStorageSamplesResult {
  recorded: number;
  duplicates: number;
}

/**
 * Records the stored bytes of every project that has a `ready` entry, counted for the clock hour
 * that contains `now`. The key carries the project and the hour, so a repeated run in the same
 * hour is a duplicate in Usage. A missed hour is not backfilled: a gap reads as zero.
 */
export async function recordStorageSamples({
  usage,
  now = new Date(),
}: {
  usage: Pick<UsageModuleClient, 'recordStorageSamples'>;
  now?: Date;
}): Promise<RecordStorageSamplesResult> {
  const windowStart = new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS).toISOString();
  const windowEnd = new Date(Date.parse(windowStart) + HOUR_MS).toISOString();

  const samples: StorageSampleInputDto[] = (await sumReadyStorageByProject()).map((project) => ({
    sampleKey: `cache:${project.projectId}:${windowStart}`,
    source: 'cache',
    workspaceId: project.workspaceId,
    projectId: project.projectId,
    windowStart,
    windowEnd,
    storedBytes: project.storedBytes,
    objectCount: project.objectCount,
  }));

  const total: RecordStorageSamplesResult = {recorded: 0, duplicates: 0};
  for (let offset = 0; offset < samples.length; offset += MAX_STORAGE_SAMPLES_BATCH_SIZE) {
    const result = await usage.recordStorageSamples({
      samples: samples.slice(offset, offset + MAX_STORAGE_SAMPLES_BATCH_SIZE),
    });
    total.recorded += result.recorded;
    total.duplicates += result.duplicates;
  }
  return total;
}
