import {execFileSync, spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {getProjectRootPath, overlayBuiltOutputs} from '@shipfox/tool-utils';
import {findProducedAmiId, readPackerAmiArtifact} from './aws.js';
import {qemuSourceImageArgs} from './qemu.js';

const WHITESPACE_PATTERN = /\s+/;
const PACKER_OUTPUT_TAIL_LENGTH = 1024 * 1024;

export type RunnerImagePlatform = 'aws' | 'qemu';
export type RunnerImageLifecycle = 'candidate' | 'release';

export interface RunnerImageBuild {
  os: string;
  platform: RunnerImagePlatform;
  architecture: 'amd64' | 'arm64';
  buildAttempt: string;
  buildNumber: string;
  candidateExpiresAt?: string;
  candidateId?: string;
  candidateKmsKeyId?: string;
  candidateConsumerAccountIds?: string[];
  lifecycle: RunnerImageLifecycle;
  nodeVersion: string;
  revision: string;
  runnerVersion?: string;
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
    '-timestamp-ui',
    '-only',
    `runner.${source}.build_image`,
    '-var',
    `image_os=${build.os}`,
    '-var',
    `architecture=${build.architecture}`,
    '-var',
    `build_attempt=${build.buildAttempt}`,
    '-var',
    `build_number=${build.buildNumber}`,
    '-var',
    `image_lifecycle=${build.lifecycle}`,
    '-var',
    `node_version=${build.nodeVersion}`,
    '-var',
    `revision=${build.revision}`,
    '-var',
    `platform=${build.platform}`,
    '-var',
    `runner_workspace=${workspacePath}`,
  ];
  if (build.candidateId) {
    args.push('-var', `candidate_id=${build.candidateId}`);
  }
  if (build.candidateExpiresAt) {
    args.push('-var', `candidate_expires_at=${build.candidateExpiresAt}`);
  }
  if (build.lifecycle === 'candidate' && build.platform === 'aws') {
    if (!build.candidateKmsKeyId) {
      throw new Error('Candidate AWS builds require candidateKmsKeyId.');
    }
    if (!build.candidateConsumerAccountIds?.length) {
      throw new Error('Candidate AWS builds require candidate consumer accounts.');
    }
    args.push('-var', `candidate_kms_key_id=${build.candidateKmsKeyId}`);
    args.push('-var', `candidate_ami_users=${JSON.stringify(build.candidateConsumerAccountIds)}`);
  }
  if (build.runnerVersion) args.push('-var', `runner_version=${build.runnerVersion}`);
  if (build.platform === 'qemu') args.push(...qemuSourceImageArgs(rootDir));
  return [...args, ...build.extraPackerArgs, '.'];
}

export async function buildRunnerImage(build: RunnerImageBuild): Promise<{amiId: string | null}> {
  const rootDir = getProjectRootPath(import.meta.url);
  const stageDir = await mkdtemp(join(tmpdir(), 'shipfox-runner-image-'));
  const workspacePath = join(stageDir, 'workspace');
  const manifestPath = join(rootDir, 'packer-manifest.json');

  try {
    execFileSync('turbo', ['prune', '@shipfox/runner', '--out-dir', workspacePath], {
      cwd: rootDir,
      stdio: 'inherit',
    });
    overlayBuiltOutputs({prunedRoot: workspacePath});
    execFileSync('packer', ['init', '.'], {cwd: rootDir, stdio: 'inherit'});
    await rm(manifestPath, {force: true});
    const output = await runPackerBuild(build, workspacePath, rootDir);
    if (build.platform !== 'aws') return {amiId: null};

    try {
      return {amiId: readPackerAmiArtifact(manifestPath).amiId};
    } catch (error) {
      if (isMissingManifest(error)) return {amiId: findProducedAmiId(output)};
      throw error;
    }
  } finally {
    await rm(stageDir, {force: true, recursive: true});
  }
}

// Stream so CI shows each phase as it happens. Keep only the output tail, where Packer reports
// the produced AMI, to recover its ID when a successful build leaves no manifest.
function runPackerBuild(
  build: RunnerImageBuild,
  workspacePath: string,
  rootDir: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const packer = spawn('packer', packerBuildArgs(build, workspacePath, rootDir), {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let output = '';
    packer.stdout.setEncoding('utf8');
    packer.stdout.on('data', (chunk: string) => {
      output = (output + chunk).slice(-PACKER_OUTPUT_TAIL_LENGTH);
      process.stdout.write(chunk);
    });
    packer.on('error', reject);
    packer.on('close', (code, signal) => {
      if (code === 0) resolve(output);
      else reject(new Error(`packer build failed with ${signal ?? `exit code ${code}`}.`));
    });
  });
}

function isMissingManifest(error: unknown): boolean {
  return (
    error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
