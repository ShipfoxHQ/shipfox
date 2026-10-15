import {type RunnerPlatformDto, runnerPlatformSchema} from '@shipfox/api-runners-dto';

export function runnerPlatform(
  host: {platform: NodeJS.Platform; arch: string} = {
    platform: process.platform,
    arch: process.arch,
  },
): RunnerPlatformDto | undefined {
  const os = host.platform === 'win32' ? 'windows' : host.platform;
  const parsed = runnerPlatformSchema.safeParse({os, arch: host.arch});
  return parsed.success ? parsed.data : undefined;
}
