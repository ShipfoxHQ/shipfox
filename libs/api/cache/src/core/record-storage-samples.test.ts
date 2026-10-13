import type {StorageSampleInputDto} from '@shipfox/api-usage-dto';
import {
  archiveOf,
  archiveOfSize,
  cacheClient,
  createCacheTestApp,
  saveEntry,
  startJob,
  type TestApp,
} from '#test/fixtures/cache-api.js';
import {recordStorageSamples} from './record-storage-samples.js';

/** Stands in for Usage: dedupes by sample key the way the real command does. */
function fakeUsage() {
  const stored = new Map<string, StorageSampleInputDto>();
  const batches: number[] = [];
  return {
    stored,
    batches,
    client: {
      recordStorageSamples: ({samples}: {samples: StorageSampleInputDto[]}) => {
        batches.push(samples.length);
        let recorded = 0;
        let duplicates = 0;
        for (const sample of samples) {
          if (stored.has(sample.sampleKey)) {
            duplicates += 1;
          } else {
            stored.set(sample.sampleKey, sample);
            recorded += 1;
          }
        }
        return Promise.resolve({recorded, duplicates});
      },
    },
  };
}

describe('recordStorageSamples', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createCacheTestApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  const now = new Date('2026-10-13T10:05:30.000Z');

  it('records one sample per project with its ready bytes for the clock hour', async () => {
    const first = await startJob();
    const second = await startJob();
    await saveEntry(testApp.app, first, {key: 'a', body: archiveOf('12345')});
    await saveEntry(testApp.app, first, {key: 'b', scope: 'other', body: archiveOfSize(100)});
    await saveEntry(testApp.app, second, {key: 'a', body: archiveOfSize(7)});
    const usage = fakeUsage();

    await recordStorageSamples({usage: usage.client, now});

    const windowStart = '2026-10-13T10:00:00.000Z';
    expect(usage.stored.get(`cache:${first.projectId}:${windowStart}`)).toEqual({
      sampleKey: `cache:${first.projectId}:${windowStart}`,
      source: 'cache',
      workspaceId: first.workspaceId,
      projectId: first.projectId,
      windowStart,
      windowEnd: '2026-10-13T11:00:00.000Z',
      storedBytes: 105,
      objectCount: 2,
    });
    expect(usage.stored.get(`cache:${second.projectId}:${windowStart}`)).toMatchObject({
      storedBytes: 7,
      objectCount: 1,
    });
  });

  it('counts a repeated run for the same hour as duplicates and records nothing twice', async () => {
    const job = await startJob();
    await saveEntry(testApp.app, job, {key: 'a', body: archiveOf('data')});
    const usage = fakeUsage();

    const first = await recordStorageSamples({usage: usage.client, now});
    const repeat = await recordStorageSamples({
      usage: usage.client,
      now: new Date('2026-10-13T10:50:00.000Z'),
    });

    expect(first.recorded).toBeGreaterThanOrEqual(1);
    expect(repeat).toEqual({recorded: 0, duplicates: first.recorded});
    expect([...usage.stored.keys()].filter((key) => key.includes(job.projectId))).toHaveLength(1);
  });

  it('records a new sample in the next hour', async () => {
    const job = await startJob();
    await saveEntry(testApp.app, job, {key: 'a', body: archiveOf('data')});
    const usage = fakeUsage();

    await recordStorageSamples({usage: usage.client, now});
    await recordStorageSamples({usage: usage.client, now: new Date('2026-10-13T11:05:00.000Z')});

    expect([...usage.stored.keys()].filter((key) => key.includes(job.projectId)).sort()).toEqual([
      `cache:${job.projectId}:2026-10-13T10:00:00.000Z`,
      `cache:${job.projectId}:2026-10-13T11:00:00.000Z`,
    ]);
  });

  it('leaves out a project whose only entry is still uploading', async () => {
    const job = await startJob();
    const reserved = await cacheClient(testApp.app, job).reserve({
      key: 'pending',
      body: archiveOf('data'),
    });
    expect(reserved.json().status).toBe('reserved');
    const usage = fakeUsage();

    await recordStorageSamples({usage: usage.client, now});

    expect([...usage.stored.keys()].some((key) => key.includes(job.projectId))).toBe(false);
  });
});
