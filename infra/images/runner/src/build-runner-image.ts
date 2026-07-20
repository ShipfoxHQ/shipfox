import {pathToFileURL} from 'node:url';
import {log} from '@shipfox/tool-utils';
import {
  buildRunnerImage,
  type RunnerImageLifecycle,
  type RunnerImagePlatform,
  readMiseNodeVersion,
} from './runner-image.js';

export function parseBuildRunnerImageArgs(args: string[], env = process.env, nodeVersion?: string) {
  const [os, platform, ...extraPackerArgs] = args;
  if (!os || !platform)
    throw new Error('Usage: build-runner-image <os> <aws|qemu> [packer options]');
  if (!['aws', 'qemu'].includes(platform)) throw new Error('Platform must be aws or qemu.');
  if (!env.BUILD_NUMBER) throw new Error('BUILD_NUMBER is not set.');
  if (!env.BUILD_ATTEMPT) throw new Error('BUILD_ATTEMPT is not set.');
  if (!env.BUILD_ARCH || !['amd64', 'arm64'].includes(env.BUILD_ARCH)) {
    throw new Error('BUILD_ARCH must be amd64 or arm64.');
  }
  const lifecycle = (env.BUILD_IMAGE_LIFECYCLE ?? 'release') as RunnerImageLifecycle;
  if (!['candidate', 'release'].includes(lifecycle)) {
    throw new Error('BUILD_IMAGE_LIFECYCLE must be candidate or release.');
  }
  const sharedBuild = {
    os,
    platform: platform as RunnerImagePlatform,
    architecture: env.BUILD_ARCH as 'amd64' | 'arm64',
    buildAttempt: env.BUILD_ATTEMPT,
    buildNumber: env.BUILD_NUMBER,
    lifecycle,
    nodeVersion: nodeVersion ?? readMiseNodeVersion(),
    revision: env.BUILD_REVISION ?? env.GITHUB_SHA ?? 'local',
    extraPackerArgs,
  };
  if (lifecycle === 'candidate') {
    return {
      ...sharedBuild,
      candidateExpiresAt: required(env.BUILD_CANDIDATE_EXPIRES_AT, 'BUILD_CANDIDATE_EXPIRES_AT'),
      candidateId: required(env.BUILD_CANDIDATE_ID, 'BUILD_CANDIDATE_ID'),
    };
  }

  return {
    ...sharedBuild,
    runnerVersion: required(env.BUILD_RUNNER_VERSION, 'BUILD_RUNNER_VERSION'),
  };
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

export function runBuildRunnerImageCli(args = process.argv.slice(2)): void {
  const build = parseBuildRunnerImageArgs(args);
  buildRunnerImage(build).then(
    ({amiId}) => {
      if (amiId) log.info(`Runner AMI build complete: ${amiId}`);
    },
    (error: unknown) => {
      log.error(String(error));
      process.exitCode = 1;
    },
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runBuildRunnerImageCli();
}
