import type {Image} from '@aws-sdk/client-ec2';
import type {RunnerBaseBuildResult} from '#build-runner-base.js';
import {RUNNER_BASE_POINTER_PARAMETER, type RunnerBaseArchitecture} from '#metadata.js';
import {
  CANONICAL_SOURCE_PARAMETERS,
  parseRunnerBaseBuildResult,
  planRunnerBase,
  publishRunnerBase,
} from '#publication.js';
import {
  AMI,
  addPublishedGeneration,
  BUILD_URL,
  FakeAws,
  GENERATION,
  KEY_ALIAS,
  KEY_ARN,
  NEW_RECIPE,
  NOW,
  OLD_AMI,
  OTHER_KEY_ARN,
  OWNER,
  publishedMetadata,
  RECIPE,
  REVISION,
  SNAPSHOT,
  SOURCE,
} from './fixtures/aws.js';

function buildResult(
  architecture: RunnerBaseArchitecture,
  overrides: Partial<RunnerBaseBuildResult> = {},
): RunnerBaseBuildResult {
  return {
    architecture,
    amiId: AMI[architecture],
    builtAt: '2026-09-27T10:00:00.000Z',
    generation: GENERATION,
    imageOs: 'ubuntu24',
    recipeDigest: RECIPE,
    region: 'eu-central-1',
    revision: REVISION,
    sourceAmiId: SOURCE[architecture],
    verifiedAt: architecture === 'amd64' ? '2026-09-27T10:30:00.000Z' : '2026-09-27T10:25:00.000Z',
    ...overrides,
  };
}

describe('planRunnerBase', () => {
  let aws: FakeAws;

  beforeEach(() => {
    aws = new FakeAws();
    aws.addCanonicalSources();
  });

  function plan(options: {force?: boolean; recipeDigest?: string; now?: Date} = {}) {
    return planRunnerBase({
      clients: aws.clients(),
      force: options.force ?? false,
      kmsKeyId: KEY_ALIAS,
      recipeDigest: options.recipeDigest ?? RECIPE,
      now: options.now ?? NOW,
    });
  }

  it('builds from one pinned Canonical pair when no base is published', async () => {
    const result = await plan();

    expect(result).toMatchObject({mode: 'build', reason: 'missing', kmsKeyArn: KEY_ARN});
    expect(result.sources).toEqual({
      amd64: expect.objectContaining({architecture: 'amd64', amiId: SOURCE.amd64}),
      arm64: expect.objectContaining({architecture: 'arm64', amiId: SOURCE.arm64}),
    });
  });

  it('reuses a compatible, available, and fresh base without resolving sources', async () => {
    addPublishedGeneration(aws);

    const result = await plan();

    expect(result).toMatchObject({mode: 'reuse', reason: 'current', sources: null});
    expect(result.current).toMatchObject({
      generation: '17000000000-1',
      createdAt: '2026-09-25T10:00:00.000Z',
    });
  });

  it('builds when forced even if the current base is compatible', async () => {
    addPublishedGeneration(aws);

    await expect(plan({force: true})).resolves.toMatchObject({mode: 'build', reason: 'forced'});
  });

  it('rebuilds after a recipe change', async () => {
    addPublishedGeneration(aws);

    await expect(plan({recipeDigest: NEW_RECIPE})).resolves.toMatchObject({
      mode: 'build',
      reason: 'recipe-changed',
    });
  });

  it('rebuilds when the candidate alias resolves to another key', async () => {
    addPublishedGeneration(aws);
    aws.keyArn = OTHER_KEY_ARN;

    await expect(plan()).resolves.toMatchObject({mode: 'build', reason: 'key-changed'});
  });

  it('rebuilds a base whose older image is past seven days', async () => {
    addPublishedGeneration(aws);

    // The older amd64 image turns seven days old at 2026-10-02T10:00Z; arm64 is five minutes younger.
    await expect(plan({now: new Date('2026-10-02T10:00:00.000Z')})).resolves.toMatchObject({
      mode: 'reuse',
    });
    await expect(plan({now: new Date('2026-10-02T10:01:00.000Z')})).resolves.toMatchObject({
      mode: 'build',
      reason: 'stale',
    });
  });

  it('rebuilds when a published image is missing', async () => {
    addPublishedGeneration(aws);
    aws.images.delete(OLD_AMI.arm64);

    await expect(plan()).resolves.toMatchObject({mode: 'build', reason: 'unavailable'});
  });

  it('rebuilds when a published image is not marked verified', async () => {
    addPublishedGeneration(aws);
    aws.addBase({
      architecture: 'amd64',
      amiId: OLD_AMI.amd64,
      snapshotId: 'snap-33333333333333333',
      createdAt: '2026-09-25T10:00:00.000Z',
      generation: '17000000000-1',
    });

    await expect(plan()).resolves.toMatchObject({mode: 'build', reason: 'unavailable'});
  });

  it('rebuilds over an invalid pointer', async () => {
    aws.parameters.set(RUNNER_BASE_POINTER_PARAMETER, '{"apiVersion":"shipfox.runner-base/v0"}');

    await expect(plan()).resolves.toMatchObject({mode: 'build', reason: 'invalid'});
  });

  it.each([
    ['another owner', {OwnerId: OWNER}, 'not Canonical'],
    ['another architecture', {Architecture: 'x86_64'}, 'architecture x86_64'],
    [
      'another Ubuntu release',
      {Name: 'ubuntu/images/hvm-ssd-gp3/ubuntu-jammy-22.04-arm64-server-20260920'},
      'not an Ubuntu 24.04 arm64 server image',
    ],
    ['an unavailable image', {State: 'deregistered'}, 'is deregistered'],
  ] as [
    string,
    Partial<Image>,
    string,
  ][])('rejects a Canonical source from %s', async (_label, override, message) => {
    aws.addCanonicalSources({arm64: override});

    await expect(plan()).rejects.toThrow(message);
  });

  it('rejects a missing Canonical source parameter', async () => {
    aws.parameters.delete(CANONICAL_SOURCE_PARAMETERS.amd64);

    await expect(plan()).rejects.toThrow('Canonical source parameters are missing');
  });

  it('rejects a disabled candidate key', async () => {
    aws.keyState = 'Disabled';

    await expect(plan()).rejects.toThrow('is Disabled');
  });
});

describe('publishRunnerBase', () => {
  let aws: FakeAws;

  beforeEach(() => {
    aws = new FakeAws();
    aws.addBuiltPair();
  });

  function publish(
    options: {results?: RunnerBaseBuildResult[]; trustedRecipeDigest?: string; now?: Date} = {},
  ) {
    return publishRunnerBase({
      clients: aws.clients(),
      results: options.results ?? [buildResult('arm64'), buildResult('amd64')],
      kmsKeyId: KEY_ALIAS,
      trustedRecipeDigest: options.trustedRecipeDigest ?? RECIPE,
      buildUrl: BUILD_URL,
      now: options.now ?? NOW,
    });
  }

  it('marks both images and snapshots verified before writing one complete generation', async () => {
    const publication = await publish();

    expect(publication.status).toBe('published');
    expect(aws.puts).toHaveLength(1);
    expect(aws.pointer()).toEqual({
      apiVersion: 'shipfox.runner-base/v1',
      generation: GENERATION,
      recipeDigest: RECIPE,
      sourceRevision: REVISION,
      buildUrl: BUILD_URL,
      // Pair freshness follows the older image, not the verification time.
      createdAt: '2026-09-27T10:05:00.000Z',
      verifiedAt: '2026-09-27T10:30:00.000Z',
      owner: OWNER,
      region: 'eu-central-1',
      kmsKeyArn: KEY_ARN,
      imageOs: 'ubuntu24',
      images: [
        {
          architecture: 'amd64',
          amiId: AMI.amd64,
          sourceAmiId: SOURCE.amd64,
          createdAt: '2026-09-27T10:10:00.000Z',
        },
        {
          architecture: 'arm64',
          amiId: AMI.arm64,
          sourceAmiId: SOURCE.arm64,
          createdAt: '2026-09-27T10:05:00.000Z',
        },
      ],
    });
    for (const resource of [...Object.values(AMI), ...Object.values(SNAPSHOT)]) {
      expect(aws.tagsOf(resource)['shipfox.base_status']).toBe('verified');
    }
  });

  it('keeps the previous pointer when an architecture is missing', async () => {
    addPublishedGeneration(aws);
    const previous = aws.parameters.get(RUNNER_BASE_POINTER_PARAMETER);

    await expect(publish({results: [buildResult('amd64')]})).rejects.toThrow(
      'exactly one amd64 and one arm64',
    );
    expect(aws.parameters.get(RUNNER_BASE_POINTER_PARAMETER)).toBe(previous);
    expect(aws.createTagCalls).toBe(0);
  });

  it('rejects results from different generations', async () => {
    await expect(
      publish({results: [buildResult('amd64'), buildResult('arm64', {generation: '1-1'})]}),
    ).rejects.toThrow('disagree on generation');
  });

  it('rejects a recipe that trusted main no longer expects', async () => {
    await expect(publish({trustedRecipeDigest: NEW_RECIPE})).rejects.toThrow('obsolete checkout');
    expect(aws.puts).toHaveLength(0);
    expect(aws.createTagCalls).toBe(0);
  });

  it('rejects a snapshot encrypted with another key', async () => {
    aws.addBase({
      architecture: 'arm64',
      amiId: AMI.arm64,
      snapshotId: SNAPSHOT.arm64,
      createdAt: '2026-09-27T10:05:00.000Z',
      kmsKeyArn: OTHER_KEY_ARN,
    });

    await expect(publish()).rejects.toThrow(`is not encrypted with ${KEY_ARN}`);
    expect(aws.puts).toHaveLength(0);
  });

  it('rejects an image whose identity tags do not match its result', async () => {
    aws.addBase({
      architecture: 'arm64',
      amiId: AMI.arm64,
      snapshotId: SNAPSHOT.arm64,
      createdAt: '2026-09-27T10:05:00.000Z',
      recipeDigest: NEW_RECIPE,
    });

    await expect(publish()).rejects.toThrow('shipfox.base_recipe');
    expect(aws.puts).toHaveLength(0);
  });

  it('keeps the previous pointer after a partial tagging failure and reconciles on retry', async () => {
    addPublishedGeneration(aws);
    const previous = aws.parameters.get(RUNNER_BASE_POINTER_PARAMETER);
    aws.failNextCreateTags = true;

    await expect(publish()).rejects.toThrow('CreateTags throttled');
    expect(aws.parameters.get(RUNNER_BASE_POINTER_PARAMETER)).toBe(previous);
    expect(aws.tagsOf(AMI.amd64)['shipfox.base_status']).toBe('verified');
    expect(aws.tagsOf(SNAPSHOT.amd64)['shipfox.base_status']).toBe('building');

    await expect(publish()).resolves.toMatchObject({status: 'published'});
    expect(aws.tagsOf(SNAPSHOT.amd64)['shipfox.base_status']).toBe('verified');
    expect(aws.pointer()?.generation).toBe(GENERATION);
  });

  it('does not rewrite a generation that is already published', async () => {
    await publish();

    await expect(publish()).resolves.toMatchObject({status: 'already-published'});
    expect(aws.puts).toHaveLength(1);
  });

  it('refuses to replace a newer published generation', async () => {
    const newer = publishedMetadata({
      generation: '19000000000-1',
      createdAt: '2026-09-27T11:00:00.000Z',
      verifiedAt: '2026-09-27T11:30:00.000Z',
      images: publishedMetadata().images.map((image) => ({
        ...image,
        createdAt: '2026-09-27T11:00:00.000Z',
      })),
    });
    addPublishedGeneration(aws, newer);

    await expect(publish()).rejects.toThrow('19000000000-1 is newer');
    expect(aws.pointer()?.generation).toBe('19000000000-1');
  });

  it('rejects a pair older than seven days', async () => {
    await expect(publish({now: new Date('2026-10-05T00:00:00.000Z')})).rejects.toThrow(
      'the limit is 7',
    );
    expect(aws.puts).toHaveLength(0);
  });

  it('replaces an invalid pointer', async () => {
    aws.parameters.set(RUNNER_BASE_POINTER_PARAMETER, 'not json');

    await expect(publish()).resolves.toMatchObject({status: 'published'});
    expect(aws.pointer()?.generation).toBe(GENERATION);
  });
});

describe('parseRunnerBaseBuildResult', () => {
  it('accepts a build command result', () => {
    expect(parseRunnerBaseBuildResult(buildResult('amd64'), 'amd64.json')).toEqual(
      buildResult('amd64'),
    );
  });

  it.each([
    ['a missing field', {verifiedAt: undefined}, 'verifiedAt'],
    ['an unknown architecture', {architecture: 'x86_64'}, 'architecture'],
    ['an invalid AMI', {amiId: 'ami-1'}, 'amiId'],
  ])('rejects %s', (_label, overrides, message) => {
    expect(() =>
      parseRunnerBaseBuildResult({...buildResult('amd64'), ...overrides}, 'amd64.json'),
    ).toThrow(message);
  });
});
