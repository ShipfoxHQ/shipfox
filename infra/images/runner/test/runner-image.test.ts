import {execFileSync} from 'node:child_process';
import {findProducedAmiId} from '#aws.js';
import {packerBuildArgs, readMiseNodeVersion} from '#runner-image.js';

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
        buildNumber: '42',
        nodeVersion: '24.17.0',
        extraPackerArgs: ['-var', 'push_image=true'],
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
      'build_number=42',
      '-var',
      'node_version=24.17.0',
      '-var',
      'platform=aws',
      '-var',
      'runner_workspace=/tmp/workspace',
      '-var',
      'push_image=true',
      '.',
    ]);
  });
});

describe('findProducedAmiId', () => {
  it('extracts the final AMI identifier from Packer output', () => {
    const amiId = findProducedAmiId(
      'Found Image ID: ami-0123abc456def7890\nAMIs were created: ami-0fedcba9876543210',
    );

    expect(amiId).toBe('ami-0fedcba9876543210');
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
