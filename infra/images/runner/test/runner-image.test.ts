import {execFileSync} from 'node:child_process';
import {findProducedAmiId, parsePackerAmiArtifact} from '#aws.js';
import {parseBuildRunnerImageArgs} from '#build-runner-image.js';
import {buildRunnerImageCandidate, parseRunnerImageCandidateArgs} from '#candidate.js';
import {packerBuildArgs, readMiseNodeVersion} from '#runner-image.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('readMiseNodeVersion', () => {
  it('reads the selected Node version from mise', () => {
    const version = readMiseNodeVersion(() => '24.17.0\n');

    expect(version).toBe('24.17.0');
  });
});

describe('packerBuildArgs', () => {
  it('targets the AWS image source and passes the shared image variables', () => {
    const args = packerBuildArgs(
      {
        os: 'ubuntu24',
        platform: 'aws',
        architecture: 'amd64',
        buildAttempt: '1',
        buildNumber: '42',
        lifecycle: 'release',
        nodeVersion: '24.17.0',
        revision: '0123456789abcdef0123456789abcdef01234567',
        runnerVersion: '0.1.0',
        extraPackerArgs: [],
      },
      '/tmp/workspace',
    );

    expect(args).toEqual([
      'build',
      '-only',
      'runner.amazon-ebs.build_image',
      '-var',
      'image_os=ubuntu24',
      '-var',
      'architecture=amd64',
      '-var',
      'build_attempt=1',
      '-var',
      'build_number=42',
      '-var',
      'image_lifecycle=release',
      '-var',
      'node_version=24.17.0',
      '-var',
      'revision=0123456789abcdef0123456789abcdef01234567',
      '-var',
      'platform=aws',
      '-var',
      'runner_workspace=/tmp/workspace',
      '-var',
      'runner_version=0.1.0',
      '.',
    ]);
  });

  it('passes a checked custom QEMU source relative to the project root', () => {
    vi.stubEnv('SHIPFOX_QEMU_SOURCE_IMAGE', 'test-images/ubuntu.raw');
    vi.stubEnv('SHIPFOX_QEMU_SOURCE_CHECKSUM', 'sha256:abc123');

    const args = packerBuildArgs(
      {
        os: 'ubuntu24',
        platform: 'qemu',
        architecture: 'amd64',
        buildAttempt: '1',
        buildNumber: '42',
        lifecycle: 'release',
        nodeVersion: '24.17.0',
        revision: '0123456789abcdef0123456789abcdef01234567',
        runnerVersion: '0.1.0',
        extraPackerArgs: [],
      },
      '/tmp/workspace',
      '/repo',
    );

    expect(args).toContain('qemu_source_image=/repo/test-images/ubuntu.raw');
    expect(args).toContain('qemu_source_checksum=sha256:abc123');
  });

  it('passes candidate metadata without a release version', () => {
    const args = packerBuildArgs(
      {
        os: 'ubuntu24',
        platform: 'aws',
        architecture: 'arm64',
        buildAttempt: '1',
        buildNumber: '42',
        candidateExpiresAt: '2026-08-03T10:00:00Z',
        candidateId: 'main-0123456789abcdef0123456789abcdef01234567',
        lifecycle: 'candidate',
        nodeVersion: '24.17.0',
        revision: '0123456789abcdef0123456789abcdef01234567',
        extraPackerArgs: [],
      },
      '/tmp/workspace',
    );

    expect(args).toContain('image_lifecycle=candidate');
    expect(args).toContain('candidate_id=main-0123456789abcdef0123456789abcdef01234567');
    expect(args).toContain('candidate_expires_at=2026-08-03T10:00:00Z');
    expect(args.some((arg) => arg.startsWith('runner_version='))).toBe(false);
  });

  it('rejects an unchecked custom QEMU source', () => {
    vi.stubEnv('SHIPFOX_QEMU_SOURCE_IMAGE', '/images/ubuntu.raw');
    vi.stubEnv('SHIPFOX_QEMU_SOURCE_CHECKSUM', '');

    expect(() =>
      packerBuildArgs(
        {
          os: 'ubuntu24',
          platform: 'qemu',
          architecture: 'amd64',
          buildAttempt: '1',
          buildNumber: '42',
          lifecycle: 'release',
          nodeVersion: '24.17.0',
          revision: '0123456789abcdef0123456789abcdef01234567',
          runnerVersion: '0.1.0',
          extraPackerArgs: [],
        },
        '/tmp/workspace',
      ),
    ).toThrow('SHIPFOX_QEMU_SOURCE_CHECKSUM');
  });
});

describe('findProducedAmiId', () => {
  it('extracts the final AMI identifier from Packer output', () => {
    const amiId = findProducedAmiId(
      'Found Image ID: ami-0123abc456def7890\nAMIs were created: ami-0fedcba9876543210',
    );

    expect(amiId).toBe('ami-0fedcba9876543210');
  });

  it('does not mistake a shortened identifier for an AMI', () => {
    const amiId = findProducedAmiId('AMIs were created: ami-0123abc');

    expect(amiId).toBeNull();
  });
});

describe('parsePackerAmiArtifact', () => {
  it('reads the completed AWS artifact and its provenance from Packer manifest output', () => {
    const artifact = parsePackerAmiArtifact({
      last_run_uuid: 'run-123',
      builds: [
        {
          name: 'runner.build_image',
          builder_type: 'amazon-ebs',
          packer_run_uuid: 'run-123',
          build_time: 1_784_390_400,
          artifact_id: 'eu-central-1:ami-0123abc456def7890',
          custom_data: {
            architecture: 'amd64',
            build_attempt: '1',
            build_number: '42',
            image_os: 'ubuntu24',
            revision: '0123456789abcdef0123456789abcdef01234567',
            runner_version: '0.1.0',
          },
        },
      ],
    });

    expect(artifact).toEqual({
      amiId: 'ami-0123abc456def7890',
      region: 'eu-central-1',
      buildTime: 1_784_390_400,
      customData: {
        architecture: 'amd64',
        build_attempt: '1',
        build_number: '42',
        image_os: 'ubuntu24',
        revision: '0123456789abcdef0123456789abcdef01234567',
        runner_version: '0.1.0',
      },
    });
  });
});

describe('parseBuildRunnerImageArgs', () => {
  it('parses the build target and forwards Packer options', () => {
    const build = parseBuildRunnerImageArgs(
      ['ubuntu24', 'qemu', '-var', 'qemu_accelerator=tcg'],
      {
        BUILD_ARCH: 'amd64',
        BUILD_ATTEMPT: '1',
        BUILD_NUMBER: '42',
        BUILD_REVISION: '0123456789abcdef0123456789abcdef01234567',
        BUILD_RUNNER_VERSION: '0.1.0',
      },
      '24.17.0',
    );

    expect(build).toEqual({
      os: 'ubuntu24',
      platform: 'qemu',
      architecture: 'amd64',
      buildAttempt: '1',
      buildNumber: '42',
      lifecycle: 'release',
      nodeVersion: '24.17.0',
      revision: '0123456789abcdef0123456789abcdef01234567',
      runnerVersion: '0.1.0',
      extraPackerArgs: ['-var', 'qemu_accelerator=tcg'],
    });
  });

  it('rejects missing required build metadata', () => {
    expect(() => parseBuildRunnerImageArgs(['ubuntu24', 'aws'], {}, '24.17.0')).toThrow(
      'BUILD_NUMBER is not set.',
    );
  });

  it('requires an explicit runner version', () => {
    expect(() =>
      parseBuildRunnerImageArgs(
        ['ubuntu24', 'aws'],
        {BUILD_ARCH: 'amd64', BUILD_ATTEMPT: '1', BUILD_NUMBER: '42'},
        '24.17.0',
      ),
    ).toThrow('BUILD_RUNNER_VERSION is not set.');
  });

  it('accepts candidate metadata without a release version', () => {
    const build = parseBuildRunnerImageArgs(
      ['ubuntu24', 'aws'],
      {
        BUILD_ARCH: 'amd64',
        BUILD_ATTEMPT: '1',
        BUILD_CANDIDATE_EXPIRES_AT: '2026-08-03T10:00:00Z',
        BUILD_CANDIDATE_ID: 'main-0123456789abcdef0123456789abcdef01234567',
        BUILD_IMAGE_LIFECYCLE: 'candidate',
        BUILD_NUMBER: '42',
        BUILD_REVISION: '0123456789abcdef0123456789abcdef01234567',
      },
      '24.17.0',
    );

    expect(build).toMatchObject({
      candidateExpiresAt: '2026-08-03T10:00:00Z',
      candidateId: 'main-0123456789abcdef0123456789abcdef01234567',
      lifecycle: 'candidate',
    });
    expect(build).not.toHaveProperty('runnerVersion');
  });
});

describe('runner image candidates', () => {
  const revision = '0123456789abcdef0123456789abcdef01234567';

  it('builds a candidate when no matching AMI exists', async () => {
    const build = parseBuildRunnerImageArgs(
      ['ubuntu24', 'aws'],
      {
        BUILD_ARCH: 'amd64',
        BUILD_ATTEMPT: '1',
        BUILD_CANDIDATE_EXPIRES_AT: '2026-08-03T10:00:00Z',
        BUILD_CANDIDATE_ID: `main-${revision}`,
        BUILD_IMAGE_LIFECYCLE: 'candidate',
        BUILD_NUMBER: '42',
        BUILD_REVISION: revision,
      },
      '24.17.0',
    );
    const send = vi.fn().mockResolvedValue({Images: []});
    const buildImage = vi.fn().mockResolvedValue({amiId: 'ami-0123abc456def7890'});

    const candidate = await buildRunnerImageCandidate(build, {
      build: buildImage,
      client: {send},
    });

    expect(buildImage).toHaveBeenCalledWith(build);
    expect(candidate).toEqual({
      amiId: 'ami-0123abc456def7890',
      architecture: 'amd64',
      candidateId: `main-${revision}`,
      region: 'eu-central-1',
      revision,
      status: 'built',
    });
  });

  it('reuses the matching available candidate AMI', async () => {
    const build = parseBuildRunnerImageArgs(
      ['ubuntu24', 'aws'],
      {
        BUILD_ARCH: 'arm64',
        BUILD_ATTEMPT: '1',
        BUILD_CANDIDATE_EXPIRES_AT: '2026-08-03T10:00:00Z',
        BUILD_CANDIDATE_ID: `main-${revision}`,
        BUILD_IMAGE_LIFECYCLE: 'candidate',
        BUILD_NUMBER: '42',
        BUILD_REVISION: revision,
      },
      '24.17.0',
    );
    const send = vi.fn().mockResolvedValue({
      Images: [{ImageId: 'ami-0fedcba9876543210', State: 'available'}],
    });
    const buildImage = vi.fn();

    const candidate = await buildRunnerImageCandidate(build, {
      build: buildImage,
      client: {send},
    });

    expect(buildImage).not.toHaveBeenCalled();
    expect(candidate.status).toBe('reused');
    expect(candidate.amiId).toBe('ami-0fedcba9876543210');
  });

  it('rejects duplicate available candidate AMIs', async () => {
    const build = parseBuildRunnerImageArgs(
      ['ubuntu24', 'aws'],
      {
        BUILD_ARCH: 'amd64',
        BUILD_ATTEMPT: '1',
        BUILD_CANDIDATE_EXPIRES_AT: '2026-08-03T10:00:00Z',
        BUILD_CANDIDATE_ID: `main-${revision}`,
        BUILD_IMAGE_LIFECYCLE: 'candidate',
        BUILD_NUMBER: '42',
        BUILD_REVISION: revision,
      },
      '24.17.0',
    );
    const send = vi.fn().mockResolvedValue({
      Images: [
        {ImageId: 'ami-0123abc456def7890', State: 'available'},
        {ImageId: 'ami-0fedcba9876543210', State: 'available'},
      ],
    });

    const candidate = buildRunnerImageCandidate(build, {client: {send}});

    await expect(candidate).rejects.toThrow('Expected at most one amd64 candidate AMI');
  });

  it('derives candidate metadata from the source revision and requires a result path', () => {
    const result = parseRunnerImageCandidateArgs(['--output', '/tmp/candidate.json'], {
      BUILD_ARCH: 'amd64',
      BUILD_ATTEMPT: '1',
      BUILD_NUMBER: '42',
      BUILD_REVISION: revision,
    });

    expect(result.build).toMatchObject({
      candidateId: `main-${revision}`,
      lifecycle: 'candidate',
      revision,
    });
    expect(result.outputPath).toBe('/tmp/candidate.json');
  });
});

describe('spot watchdog runtime script', () => {
  const script = new URL('../scripts/runtime/spot-watchdog.sh', import.meta.url);

  it.each(['stop', 'terminate', 'hibernate'])('parses a spaced %s IMDS notice', (action) => {
    const result = execFileSync(
      'sh',
      [
        '-c',
        '. "$1"; spot_interruption_action "$2"',
        'sh',
        script.pathname,
        `{"action": "${action}"}`,
      ],
      {encoding: 'utf8', env: {...process.env, SHIPFOX_SPOT_WATCHDOG_LIBRARY: '1'}},
    );

    expect(result.trim()).toBe(action);
  });

  it('does not treat an unrelated IMDS document as an interruption', () => {
    const result = execFileSync(
      'sh',
      [
        '-c',
        '. "$1"; spot_interruption_action "$2"',
        'sh',
        script.pathname,
        '{"action": "reboot"}',
      ],
      {encoding: 'utf8', env: {...process.env, SHIPFOX_SPOT_WATCHDOG_LIBRARY: '1'}},
    );

    expect(result.trim()).toBe('reboot');
  });
});
