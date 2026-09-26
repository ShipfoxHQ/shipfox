import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  buildRunnerBase,
  packerBaseBuildArgs,
  packerVerifyBuildArgs,
  parseBuildRunnerBaseArgs,
  parsePackerBaseArtifact,
  type RunnerBaseBuild,
} from '#build-runner-base.js';

const BUILD: RunnerBaseBuild = {
  architecture: 'arm64',
  generation: '18000000000-1',
  kmsKeyId: 'alias/shipfox-runner-image-candidate',
  recipeDigest: `sha256:${'a'.repeat(64)}`,
  revision: '0123456789abcdef0123456789abcdef01234567',
  sourceAmiId: 'ami-bbbbbbbbbbbbbbbbb',
};

const ENVIRONMENT = {
  BUILD_ARCH: 'arm64',
  BUILD_BASE_GENERATION: '18000000000-1',
  BUILD_CANDIDATE_KMS_KEY_ID: 'alias/shipfox-runner-image-candidate',
  BUILD_REVISION: '0123456789abcdef0123456789abcdef01234567',
  BUILD_SOURCE_AMI_ID: 'ami-bbbbbbbbbbbbbbbbb',
};

function packerManifest(name = 'base.base') {
  return {
    last_run_uuid: 'run-2',
    builds: [
      {
        name,
        builder_type: 'amazon-ebs',
        packer_run_uuid: 'run-1',
        artifact_id: 'eu-central-1:ami-00000000000000000',
        build_time: 1790000000,
      },
      {
        name,
        builder_type: 'amazon-ebs',
        packer_run_uuid: 'run-2',
        artifact_id: 'eu-central-1:ami-22222222222222222',
        build_time: 1790000600,
      },
    ],
  };
}

describe('build-runner-base arguments', () => {
  it('reads an explicit base build from the environment', () => {
    expect(parseBuildRunnerBaseArgs(['--output', '/tmp/base.json'], ENVIRONMENT)).toEqual({
      outputPath: '/tmp/base.json',
      build: {
        architecture: 'arm64',
        generation: '18000000000-1',
        kmsKeyId: 'alias/shipfox-runner-image-candidate',
        revision: '0123456789abcdef0123456789abcdef01234567',
        sourceAmiId: 'ami-bbbbbbbbbbbbbbbbb',
      },
    });
  });

  it.each([
    ['an output path', [], ENVIRONMENT, '--output'],
    ['an architecture', ['--output', 'x'], {...ENVIRONMENT, BUILD_ARCH: 'x86_64'}, 'BUILD_ARCH'],
    [
      'an exact source AMI',
      ['--output', 'x'],
      {...ENVIRONMENT, BUILD_SOURCE_AMI_ID: 'ubuntu-noble'},
      'BUILD_SOURCE_AMI_ID',
    ],
    [
      'a tag-safe generation',
      ['--output', 'x'],
      {...ENVIRONMENT, BUILD_BASE_GENERATION: 'run 1'},
      'BUILD_BASE_GENERATION',
    ],
    [
      'the candidate KMS key',
      ['--output', 'x'],
      {...ENVIRONMENT, BUILD_CANDIDATE_KMS_KEY_ID: ''},
      'BUILD_CANDIDATE_KMS_KEY_ID',
    ],
  ])('requires %s', (_label, args, environment, message) => {
    expect(() => parseBuildRunnerBaseArgs(args, environment)).toThrow(message);
  });
});

describe('runner base Packer arguments', () => {
  it('builds the base from the pinned source', () => {
    expect(packerBaseBuildArgs(BUILD)).toEqual([
      'build',
      '-timestamp-ui',
      '-only',
      'base.amazon-ebs.base',
      '-var',
      'architecture=arm64',
      '-var',
      'generation=18000000000-1',
      '-var',
      'kms_key_id=alias/shipfox-runner-image-candidate',
      '-var',
      `recipe_digest=sha256:${'a'.repeat(64)}`,
      '-var',
      'revision=0123456789abcdef0123456789abcdef01234567',
      '-var',
      'source_ami_id=ami-bbbbbbbbbbbbbbbbb',
      '.',
    ]);
  });

  it('verifies a new instance of the captured base', () => {
    const args = packerVerifyBuildArgs(BUILD, 'ami-22222222222222222');

    expect(args.slice(0, 4)).toEqual([
      'build',
      '-timestamp-ui',
      '-only',
      'verify.amazon-ebs.verify',
    ]);
    expect(args.slice(-3)).toEqual(['-var', 'base_ami_id=ami-22222222222222222', '.']);
  });
});

describe('runner base Packer manifest', () => {
  it('reads the base AMI from the latest run', () => {
    expect(parsePackerBaseArtifact(packerManifest())).toEqual({
      amiId: 'ami-22222222222222222',
      region: 'eu-central-1',
      buildTime: 1790000600,
    });
  });

  it('rejects a manifest without the base build', () => {
    expect(() => parsePackerBaseArtifact(packerManifest('runner.build_image'))).toThrow(
      'does not include the completed runner base AMI',
    );
  });
});

describe('buildRunnerBase', () => {
  let packageRoot: string;

  beforeEach(async () => {
    packageRoot = await mkdtemp(join(tmpdir(), 'shipfox-runner-base-build-'));
  });

  afterEach(async () => {
    await rm(packageRoot, {force: true, recursive: true});
  });

  it('verifies the captured AMI before reporting it', async () => {
    const calls: string[][] = [];
    const runPacker = async (args: string[]) => {
      calls.push(args);
      if (args.includes('base.amazon-ebs.base')) {
        await writeFile(
          join(packageRoot, 'packer-manifest.json'),
          JSON.stringify(packerManifest()),
        );
      }
    };

    const result = await buildRunnerBase(BUILD, {
      packageRoot,
      runPacker,
      now: () => new Date('2026-09-26T10:30:00.000Z'),
    });

    expect(calls.map((args) => args.slice(0, 4).join(' '))).toEqual([
      'init .',
      'build -timestamp-ui -only base.amazon-ebs.base',
      'build -timestamp-ui -only verify.amazon-ebs.verify',
    ]);
    expect(calls[2]).toContain('base_ami_id=ami-22222222222222222');
    expect(result).toEqual({
      architecture: 'arm64',
      amiId: 'ami-22222222222222222',
      builtAt: '2026-09-21T14:23:20.000Z',
      generation: '18000000000-1',
      imageOs: 'ubuntu24',
      recipeDigest: BUILD.recipeDigest,
      region: 'eu-central-1',
      revision: BUILD.revision,
      sourceAmiId: 'ami-bbbbbbbbbbbbbbbbb',
      verifiedAt: '2026-09-26T10:30:00.000Z',
    });
  });

  it('does not report a base whose fresh-instance verification fails', async () => {
    const runPacker = async (args: string[]) => {
      if (args.includes('base.amazon-ebs.base')) {
        await writeFile(
          join(packageRoot, 'packer-manifest.json'),
          JSON.stringify(packerManifest()),
        );
      }
      if (args.includes('verify.amazon-ebs.verify')) throw new Error('packer build failed');
    };

    await expect(buildRunnerBase(BUILD, {packageRoot, runPacker})).rejects.toThrow(
      'packer build failed',
    );
  });
});
