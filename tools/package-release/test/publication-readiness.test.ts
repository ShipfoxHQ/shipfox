import assert from 'node:assert/strict';

import {
  checkRegistryAvailability,
  type VersionAvailabilityCheck,
  waitForPublishedVersions,
} from '../src/publication-readiness.js';

const STILL_UNAVAILABLE_ERROR =
  /still unavailable on npm after 60s: @shipfox\/missing@2\.0\.0 \(version missing from registry metadata\)/u;
const apiServer = {name: '@shipfox/api-server', version: '33.2.0'};
const tarballUrl = 'https://registry.npmjs.org/@shipfox/api-server/-/api-server-33.2.0.tgz';

function fakeClock() {
  let current = 0;
  return {
    now: () => current,
    sleep: (ms: number) => {
      current += ms;
      return Promise.resolve();
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('waitForPublishedVersions', () => {
  test('succeeds without waiting when every version is available', async () => {
    const clock = fakeClock();
    const check = vi.fn<VersionAvailabilityCheck>(async () => undefined);

    await waitForPublishedVersions({packages: [apiServer], check, ...clock});

    assert.equal(check.mock.calls.length, 1);
    assert.equal(clock.now(), 0);
  });

  test('keeps polling a delayed version until it becomes available', async () => {
    const clock = fakeClock();
    const visibleAt = 45_000;
    const check = vi.fn<VersionAvailabilityCheck>(async () =>
      clock.now() >= visibleAt ? undefined : 'version missing from registry metadata',
    );

    await waitForPublishedVersions({
      packages: [apiServer],
      check,
      intervalMs: 15_000,
      timeoutMs: 60_000,
      ...clock,
    });

    assert.equal(check.mock.calls.length, 4);
    assert.equal(clock.now(), visibleAt);
  });

  test('stops checking versions once they are available', async () => {
    const clock = fakeClock();
    const delayed = {name: '@shipfox/api-runners', version: '33.2.0'};
    const check = vi.fn<VersionAvailabilityCheck>(async ({name}) =>
      name === delayed.name && clock.now() === 0 ? 'tarball returned status 404' : undefined,
    );

    await waitForPublishedVersions({packages: [apiServer, delayed], check, ...clock});

    assert.deepEqual(
      check.mock.calls.map(([entry]) => entry.name),
      [apiServer.name, delayed.name, delayed.name],
    );
  });

  test('fails with the missing names and versions after the deadline', async () => {
    const clock = fakeClock();
    const missing = {name: '@shipfox/missing', version: '2.0.0'};
    const check = vi.fn<VersionAvailabilityCheck>(async ({name}) =>
      name === missing.name ? 'version missing from registry metadata' : undefined,
    );

    const wait = () =>
      waitForPublishedVersions({
        packages: [apiServer, missing],
        check,
        intervalMs: 15_000,
        timeoutMs: 60_000,
        ...clock,
      });

    await assert.rejects(wait, STILL_UNAVAILABLE_ERROR);
    assert.equal(clock.now(), 60_000);
  });

  test('treats lookup failures as unavailable and keeps polling', async () => {
    const clock = fakeClock();
    const check = vi.fn<VersionAvailabilityCheck>(() =>
      clock.now() === 0
        ? Promise.reject(new Error('Registry lookup failed with status 503'))
        : Promise.resolve(undefined),
    );

    await waitForPublishedVersions({packages: [apiServer], check, ...clock});

    assert.equal(check.mock.calls.length, 2);
  });
});

describe('checkRegistryAvailability', () => {
  function stubRegistry({versions, tarballStatus}: {versions: object; tarballStatus: number}) {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      Promise.resolve(
        init?.method === 'HEAD'
          ? new Response(null, {status: tarballStatus})
          : Response.json({name: apiServer.name, versions}),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  test('reports a version absent from registry metadata', async () => {
    stubRegistry({versions: {'33.1.0': {dist: {tarball: tarballUrl}}}, tarballStatus: 200});

    const reason = await checkRegistryAvailability(apiServer);

    assert.equal(reason, 'version missing from registry metadata');
  });

  test('reports a tarball the registry does not serve yet', async () => {
    stubRegistry({versions: {'33.2.0': {dist: {tarball: tarballUrl}}}, tarballStatus: 404});

    const reason = await checkRegistryAvailability(apiServer);

    assert.equal(reason, 'tarball returned status 404');
  });

  test('accepts a version whose metadata and tarball are both served', async () => {
    const fetchMock = stubRegistry({
      versions: {'33.2.0': {dist: {tarball: tarballUrl}}},
      tarballStatus: 200,
    });

    const reason = await checkRegistryAvailability(apiServer);

    assert.equal(reason, undefined);
    assert.equal(fetchMock.mock.calls.at(-1)?.[0], tarballUrl);
  });
});
