import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {parseArgs} from 'node:util';
import {getProjectRootPath, log} from '@shipfox/tool-utils';
import {RUNNER_BASE_IMAGE_OS, type RunnerBaseArchitecture} from './metadata.js';
import {computeRunnerBaseRecipe} from './recipe.js';

const AMI_ID_PATTERN = /^ami-[0-9a-f]{17}$/u;
const GENERATION_PATTERN = /^[A-Za-z0-9._-]+$/u;
const AMI_ARTIFACT_ID_PATTERN = /^([a-z]{2}(?:-gov)?-[a-z]+-\d):(ami-[0-9a-f]{17})$/u;

export interface RunnerBaseBuild {
  architecture: RunnerBaseArchitecture;
  generation: string;
  kmsKeyId: string;
  nodeVersion: string;
  recipeDigest: string;
  revision: string;
  sourceAmiId: string;
}

export interface RunnerBaseBuildResult {
  architecture: RunnerBaseArchitecture;
  amiId: string;
  builtAt: string;
  generation: string;
  imageOs: typeof RUNNER_BASE_IMAGE_OS;
  recipeDigest: string;
  region: string;
  revision: string;
  sourceAmiId: string;
  verifiedAt: string;
}

interface RunnerBaseBuildDependencies {
  packageRoot?: string;
  runPacker?: (args: string[], cwd: string) => Promise<void>;
  now?: () => Date;
}

export function parseBuildRunnerBaseArgs(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): {outputPath: string; build: Omit<RunnerBaseBuild, 'nodeVersion' | 'recipeDigest'>} {
  const {values} = parseArgs({args, options: {output: {type: 'string'}}, strict: true});
  if (!values.output) throw new Error('Usage: build-runner-base --output <path>');

  const architecture = env.BUILD_ARCH;
  if (architecture !== 'amd64' && architecture !== 'arm64') {
    throw new Error('BUILD_ARCH must be amd64 or arm64.');
  }
  const generation = required(env.BUILD_BASE_GENERATION, 'BUILD_BASE_GENERATION');
  if (!GENERATION_PATTERN.test(generation)) {
    throw new Error(
      'BUILD_BASE_GENERATION must contain only letters, numbers, dots, underscores, or hyphens.',
    );
  }
  const sourceAmiId = required(env.BUILD_SOURCE_AMI_ID, 'BUILD_SOURCE_AMI_ID');
  if (!AMI_ID_PATTERN.test(sourceAmiId)) throw new Error('BUILD_SOURCE_AMI_ID must be an AMI ID.');

  return {
    outputPath: values.output,
    build: {
      architecture,
      generation,
      // Derived candidates reuse the base snapshot only when both share the candidate key.
      kmsKeyId: required(
        env.BUILD_CANDIDATE_KMS_KEY_ID ?? env.AWS_RUNNER_IMAGE_CANDIDATE_KMS_KEY_ID,
        'BUILD_CANDIDATE_KMS_KEY_ID',
      ),
      revision: env.BUILD_REVISION ?? env.GITHUB_SHA ?? 'local',
      sourceAmiId,
    },
  };
}

export function packerBaseBuildArgs(build: RunnerBaseBuild): string[] {
  return ['build', '-timestamp-ui', '-only', 'base.amazon-ebs.base', ...sharedVars(build), '.'];
}

export function packerVerifyBuildArgs(build: RunnerBaseBuild, baseAmiId: string): string[] {
  return [
    'build',
    '-timestamp-ui',
    '-only',
    'verify.amazon-ebs.verify',
    ...sharedVars(build),
    '-var',
    `base_ami_id=${baseAmiId}`,
    '.',
  ];
}

function sharedVars(build: RunnerBaseBuild): string[] {
  return [
    '-var',
    `architecture=${build.architecture}`,
    '-var',
    `generation=${build.generation}`,
    '-var',
    `kms_key_id=${build.kmsKeyId}`,
    '-var',
    `node_version=${build.nodeVersion}`,
    '-var',
    `recipe_digest=${build.recipeDigest}`,
    '-var',
    `revision=${build.revision}`,
    '-var',
    `source_ami_id=${build.sourceAmiId}`,
  ];
}

export async function buildRunnerBase(
  build: RunnerBaseBuild,
  dependencies: RunnerBaseBuildDependencies = {},
): Promise<RunnerBaseBuildResult> {
  const packageRoot = dependencies.packageRoot ?? getProjectRootPath(import.meta.url);
  const runPacker = dependencies.runPacker ?? spawnPacker;
  const now = dependencies.now ?? (() => new Date());
  const manifestPath = join(packageRoot, 'packer-manifest.json');

  await runPacker(['init', '.'], packageRoot);
  await rm(manifestPath, {force: true});
  await runPacker(packerBaseBuildArgs(build), packageRoot);
  const artifact = parsePackerBaseArtifact(JSON.parse(readFileSync(manifestPath, 'utf8')));
  log.info(`Runner base AMI captured: ${artifact.amiId}. Verifying a new instance.`);

  await runPacker(packerVerifyBuildArgs(build, artifact.amiId), packageRoot);
  return {
    architecture: build.architecture,
    amiId: artifact.amiId,
    builtAt: new Date(artifact.buildTime * 1000).toISOString(),
    generation: build.generation,
    imageOs: RUNNER_BASE_IMAGE_OS,
    recipeDigest: build.recipeDigest,
    region: artifact.region,
    revision: build.revision,
    sourceAmiId: build.sourceAmiId,
    verifiedAt: now().toISOString(),
  };
}

export function parsePackerBaseArtifact(value: unknown): {
  amiId: string;
  region: string;
  buildTime: number;
} {
  const manifest = record(value, 'Packer manifest');
  const builds = manifest.builds;
  if (!Array.isArray(builds)) throw new Error('Packer manifest builds must be an array.');
  // Packer records the source name, not the build-block name.
  const build = builds
    .map((item) => record(item, 'Packer manifest build'))
    .find(
      (item) =>
        item.packer_run_uuid === manifest.last_run_uuid &&
        item.builder_type === 'amazon-ebs' &&
        item.name === 'base',
    );
  if (!build) throw new Error('Packer manifest does not include the completed runner base AMI.');

  const artifact = AMI_ARTIFACT_ID_PATTERN.exec(String(build.artifact_id));
  const buildTime = build.build_time;
  if (!artifact?.[1] || !artifact[2]) {
    throw new Error(`Packer manifest has an invalid AMI artifact ID: ${String(build.artifact_id)}`);
  }
  if (typeof buildTime !== 'number' || !Number.isInteger(buildTime) || buildTime < 0) {
    throw new Error('Packer manifest build_time must be a non-negative integer.');
  }
  return {region: artifact[1], amiId: artifact[2], buildTime};
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

function spawnPacker(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const packer = spawn('packer', args, {cwd, stdio: 'inherit'});
    packer.on('error', reject);
    packer.on('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`packer ${args[0]} failed with ${signal ?? `exit code ${code}`}.`));
    });
  });
}

export function runBuildRunnerBaseCli(args = process.argv.slice(2)): void {
  const {outputPath, build} = parseBuildRunnerBaseArgs(args);
  const {digest, nodeVersion} = computeRunnerBaseRecipe();
  buildRunnerBase({...build, nodeVersion, recipeDigest: digest})
    .then(async (result) => {
      await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
      log.info(`Runner base verified: ${result.amiId} (${result.architecture}).`);
    })
    .catch((error: unknown) => {
      log.error(String(error));
      process.exitCode = 1;
    });
}
