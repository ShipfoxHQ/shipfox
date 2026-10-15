import {type RunnerPlatformDto, runnerPlatformSchema} from '@shipfox/api-runners-dto';

/** The platform the runner registers with. Throws on a platform Shipfox does not run on. */
export function runnerPlatform(
  host: {platform: NodeJS.Platform; arch: string} = {
    platform: process.platform,
    arch: process.arch,
  },
): RunnerPlatformDto {
  const os = host.platform === 'win32' ? 'windows' : host.platform;
  const parsed = runnerPlatformSchema.safeParse({os, arch: host.arch});
  if (!parsed.success) {
    throw new Error(`Shipfox runners do not support ${host.platform} on ${host.arch}.`);
  }
  return parsed.data;
}
