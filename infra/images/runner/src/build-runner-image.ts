import {log} from '@shipfox/tool-utils';
import {buildRunnerImage, type RunnerImagePlatform, readMiseNodeVersion} from './runner-image.js';

export function parseBuildRunnerImageArgs(args: string[], env = process.env) {
  const [os, platform, ...extraPackerArgs] = args;
  if (!os || !platform)
    throw new Error('Usage: build-runner-image <os> <aws|qemu> [packer options]');
  if (!['aws', 'qemu'].includes(platform)) throw new Error('Platform must be aws or qemu.');
  if (!env.BUILD_NUMBER) throw new Error('BUILD_NUMBER is not set.');
  if (!env.BUILD_ARCH || !['amd64', 'arm64'].includes(env.BUILD_ARCH)) {
    throw new Error('BUILD_ARCH must be amd64 or arm64.');
  }

  return {
    os,
    platform: platform as RunnerImagePlatform,
    architecture: env.BUILD_ARCH as 'amd64' | 'arm64',
    buildNumber: env.BUILD_NUMBER,
    nodeVersion: readMiseNodeVersion(),
    extraPackerArgs,
  };
}

const build = parseBuildRunnerImageArgs(process.argv.slice(2));
buildRunnerImage(build).then(
  ({amiId}) => {
    if (amiId) log.info(`Runner AMI build complete: ${amiId}`);
  },
  (error: unknown) => {
    log.error(String(error));
    process.exitCode = 1;
  },
);
