import {execFileSync} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {getProjectRootPath} from '@shipfox/tool-utils';
import {findProducedAmiId} from './aws.js';
import {qemuSourceImageArgs} from './qemu.js';

const WHITESPACE_PATTERN = /\s+/;

export type RunnerImagePlatform = 'aws' | 'qemu';

export interface RunnerImageBuild {
  os: string;
  platform: RunnerImagePlatform;
  architecture: 'amd64' | 'arm64';
  buildNumber: string;
  nodeVersion: string;
  extraPackerArgs: string[];
}

export function readMiseNodeVersion(
  run: (command: string, args: string[]) => string = (command, args) =>
    execFileSync(command, args, {encoding: 'utf8'}),
): string {
  return run('mise', ['current', 'node']).trim().split(WHITESPACE_PATTERN)[0] ?? '';
}

export function packerBuildArgs(
  build: RunnerImageBuild,
  workspacePath: string,
  rootDir = process.cwd(),
): string[] {
  const source = build.platform === 'aws' ? 'amazon-ebs' : 'qemu';
  const args = [
    'build',
    '-only',
    `runner.${source}.build_image`,
    '-var',
    `image_os=${build.os}`,
    '-var',
    `architecture=${build.architecture}`,
    '-var',
    `build_number=${build.buildNumber}`,
    '-var',
    `node_version=${build.nodeVersion}`,
    '-var',
    `platform=${build.platform}`,
    '-var',
    `runner_workspace=${workspacePath}`,
  ];
  if (build.platform === 'qemu') args.push(...qemuSourceImageArgs(rootDir));
  return [...args, ...build.extraPackerArgs, '.'];
}

export async function buildRunnerImage(build: RunnerImageBuild): Promise<{amiId: string | null}> {
  const rootDir = getProjectRootPath(import.meta.url);
  const stageDir = await mkdtemp(join(tmpdir(), 'shipfox-runner-image-'));
  const workspacePath = join(stageDir, 'workspace');

  try {
    execFileSync('turbo', ['prune', '@shipfox/runner', '--out-dir', workspacePath], {
      cwd: rootDir,
      stdio: 'inherit',
    });
    execFileSync('packer', ['init', '.'], {cwd: rootDir, stdio: 'inherit'});
    const output = execFileSync('packer', packerBuildArgs(build, workspacePath, rootDir), {
      cwd: rootDir,
      encoding: 'utf8',
    });
    process.stdout.write(output);
    return {amiId: build.platform === 'aws' ? findProducedAmiId(output) : null};
  } finally {
    await rm(stageDir, {force: true, recursive: true});
  }
}
