import {readFile} from 'node:fs/promises';
import {
  parseRunnerBaseMetadata,
  RUNNER_BASE_TAGS,
  type RunnerBaseMetadata,
  runnerBaseImageTags,
} from '#metadata.js';

const OWNER = '123456789012';

function metadata(overrides: Partial<RunnerBaseMetadata> = {}): RunnerBaseMetadata {
  return {
    apiVersion: 'shipfox.runner-base/v1',
    generation: '18000000000-1',
    recipeDigest: `sha256:${'a'.repeat(64)}`,
    sourceRevision: '0123456789abcdef0123456789abcdef01234567',
    buildUrl: 'https://github.com/ShipfoxHQ/shipfox/actions/runs/18000000000/attempts/1',
    createdAt: '2026-09-26T10:00:00.000Z',
    verifiedAt: '2026-09-26T10:30:00.000Z',
    owner: OWNER,
    region: 'eu-central-1',
    kmsKeyArn: `arn:aws:kms:eu-central-1:${OWNER}:key/1234abcd-12ab-34cd-56ef-1234567890ab`,
    imageOs: 'ubuntu24',
    images: [
      {
        architecture: 'amd64',
        amiId: 'ami-11111111111111111',
        sourceAmiId: 'ami-aaaaaaaaaaaaaaaaa',
        createdAt: '2026-09-26T10:10:00.000Z',
      },
      {
        architecture: 'arm64',
        amiId: 'ami-22222222222222222',
        sourceAmiId: 'ami-bbbbbbbbbbbbbbbbb',
        createdAt: '2026-09-26T10:12:00.000Z',
      },
    ],
    ...overrides,
  };
}

describe('runner base metadata', () => {
  it('accepts one complete verified generation', () => {
    const value = metadata();

    expect(parseRunnerBaseMetadata(value)).toEqual(value);
  });

  it.each([
    ['a single architecture', {images: metadata().images.slice(0, 1)}],
    [
      'two images of one architecture',
      {images: [metadata().images[0], {...metadata().images[1], architecture: 'amd64'}]},
    ],
    ['an unknown schema version', {apiVersion: 'shipfox.runner-base/v2'}],
    ['a KMS alias instead of a key ARN', {kmsKeyArn: 'alias/shipfox-runner-image-candidate'}],
    ['an abbreviated revision', {sourceRevision: '0123456'}],
    ['an unsupported OS', {imageOs: 'ubuntu22'}],
    ['a non-sha256 recipe', {recipeDigest: 'abc'}],
  ])('rejects %s', (_label, overrides) => {
    expect(() =>
      parseRunnerBaseMetadata(metadata(overrides as Partial<RunnerBaseMetadata>)),
    ).toThrow('Runner base metadata is invalid');
  });

  it('rejects unknown fields', () => {
    expect(() => parseRunnerBaseMetadata({...metadata(), latest: true})).toThrow(
      'Runner base metadata is invalid',
    );
  });

  it('rejects a key from another account or region', () => {
    expect(() =>
      parseRunnerBaseMetadata(
        metadata({kmsKeyArn: 'arn:aws:kms:eu-west-1:123456789012:key/1234abcd'}),
      ),
    ).toThrow('kmsKeyArn must belong to its owner and region');
    expect(() =>
      parseRunnerBaseMetadata(
        metadata({kmsKeyArn: 'arn:aws:kms:eu-central-1:210987654321:key/1234abcd'}),
      ),
    ).toThrow('kmsKeyArn must belong to its owner and region');
  });

  it('rejects an image created after verification', () => {
    expect(() =>
      parseRunnerBaseMetadata(metadata({verifiedAt: '2026-09-26T10:11:00.000Z'})),
    ).toThrow('arm64 image was created after verification');
  });
});

describe('runner base tags', () => {
  it('names every base AMI and snapshot tag', () => {
    expect(
      runnerBaseImageTags({
        architecture: 'arm64',
        generation: '18000000000-1',
        recipeDigest: `sha256:${'a'.repeat(64)}`,
        revision: '0123456789abcdef0123456789abcdef01234567',
        status: 'verified',
      }),
    ).toEqual({
      'shipfox.managed': 'true',
      'shipfox.lifecycle': 'runner-base',
      'shipfox.image_os': 'ubuntu24',
      'shipfox.architecture': 'arm64',
      'shipfox.base_generation': '18000000000-1',
      'shipfox.base_recipe': `sha256:${'a'.repeat(64)}`,
      'shipfox.revision': '0123456789abcdef0123456789abcdef01234567',
      'shipfox.base_status': 'verified',
    });
  });

  it('matches the tags the Packer template writes', async () => {
    const locals = await readFile(new URL('../locals.pkr.hcl', import.meta.url), 'utf8');

    for (const tag of Object.values(RUNNER_BASE_TAGS)) {
      expect(locals).toContain(`"${tag}"`);
    }
    expect(locals).toContain('"shipfox.lifecycle"       = "runner-base"');
    expect(locals).toContain('"shipfox.base_status"     = "building"');
  });
});
