import {writeFile} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import {DescribeImagesCommand, EC2Client, type Image} from '@aws-sdk/client-ec2';
import {log} from '@shipfox/tool-utils';
import {parseBuildRunnerImageArgs} from './build-runner-image.js';
import {buildRunnerImage, type RunnerImageBuild} from './runner-image.js';

const DEFAULT_CANDIDATE_TTL_DAYS = 14;
const GIT_REVISION_PATTERN = /^[a-f0-9]{40}$/u;
const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/u;

export interface RunnerImageCandidate {
  amiId: string;
  architecture: 'amd64' | 'arm64';
  candidateId: string;
  region: string;
  revision: string;
  status: 'built' | 'reused';
}

interface Ec2ClientLike {
  send(command: DescribeImagesCommand): Promise<{Images?: Image[]}>;
}

interface BuildRunnerImageCandidateOptions {
  build?: (build: RunnerImageBuild) => Promise<{amiId: string | null}>;
  client?: Ec2ClientLike;
  region?: string;
}

export async function buildRunnerImageCandidate(
  build: RunnerImageBuild,
  options: BuildRunnerImageCandidateOptions = {},
): Promise<RunnerImageCandidate> {
  if (build.lifecycle !== 'candidate' || !build.candidateId || !build.candidateExpiresAt) {
    throw new Error('Runner image candidate builds require candidate lifecycle metadata.');
  }
  const candidateId = build.candidateId;
  const region = options.region ?? 'us-east-1';
  const client = options.client ?? new EC2Client({region});
  const existingAmiId = await findRunnerImageCandidate(client, build.revision, build.architecture);
  if (existingAmiId) {
    return candidateResult('reused', existingAmiId, build, candidateId, region);
  }

  const result = await (options.build ?? buildRunnerImage)(build);
  if (!result.amiId) throw new Error('Packer did not report a runner candidate AMI.');

  return candidateResult('built', result.amiId, build, candidateId, region);
}

export function parseRunnerImageCandidateArgs(
  args: string[],
  env = process.env,
): {
  build: RunnerImageBuild;
  outputPath: string;
  region: string;
} {
  const {values, positionals} = parseArgs({
    args,
    strict: true,
    options: {output: {type: 'string'}},
  });
  if (positionals.length)
    throw new Error('build-runner-image-candidate does not accept arguments.');
  const revision = required(env.BUILD_REVISION ?? env.GITHUB_SHA, 'BUILD_REVISION');
  if (!GIT_REVISION_PATTERN.test(revision)) {
    throw new Error('BUILD_REVISION must be a full lowercase Git revision.');
  }
  const ttlDays = candidateTtlDays(env.RUNNER_IMAGE_CANDIDATE_TTL_DAYS);
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
  const build = parseBuildRunnerImageArgs(['ubuntu24', 'aws'], {
    ...env,
    BUILD_CANDIDATE_EXPIRES_AT: expiresAt,
    BUILD_CANDIDATE_ID: `main-${revision}`,
    BUILD_IMAGE_LIFECYCLE: 'candidate',
    BUILD_REVISION: revision,
  });

  return {
    build,
    outputPath: required(values.output, '--output'),
    region: env.AWS_REGION ?? 'us-east-1',
  };
}

export function runRunnerImageCandidateCli(args = process.argv.slice(2)): void {
  void runRunnerImageCandidateCliAsync(args).catch((error: unknown) => {
    log.error(String(error));
    process.exitCode = 1;
  });
}

async function runRunnerImageCandidateCliAsync(args: string[]): Promise<void> {
  const {build, outputPath, region} = parseRunnerImageCandidateArgs(args);
  const candidate = await buildRunnerImageCandidate(build, {region});
  await writeFile(outputPath, `${JSON.stringify(candidate, null, 2)}\n`);
  log.info(`Runner image candidate ${candidate.status}: ${candidate.region}:${candidate.amiId}`);
}

async function findRunnerImageCandidate(
  client: Ec2ClientLike,
  revision: string,
  architecture: 'amd64' | 'arm64',
): Promise<string | null> {
  const output = await client.send(
    new DescribeImagesCommand({
      Owners: ['self'],
      Filters: [
        {Name: 'tag:shipfox.managed', Values: ['true']},
        {Name: 'tag:shipfox.lifecycle', Values: ['candidate']},
        {Name: 'tag:shipfox.revision', Values: [revision]},
        {Name: 'tag:shipfox.architecture', Values: [architecture]},
      ],
    }),
  );
  const imageIds = (output.Images ?? [])
    .filter((image) => image.State === 'available' && image.ImageId)
    .map((image) => image.ImageId as string);
  if (imageIds.length > 1) {
    throw new Error(
      `Expected at most one ${architecture} candidate AMI for ${revision}, found: ${imageIds.join(', ')}.`,
    );
  }
  return imageIds[0] ?? null;
}

function candidateResult(
  status: RunnerImageCandidate['status'],
  amiId: string,
  build: RunnerImageBuild,
  candidateId: string,
  region: string,
): RunnerImageCandidate {
  return {
    status,
    amiId,
    architecture: build.architecture,
    candidateId,
    region,
    revision: build.revision,
  };
}

function candidateTtlDays(value: string | undefined): number {
  if (!value) return DEFAULT_CANDIDATE_TTL_DAYS;
  if (!POSITIVE_INTEGER_PATTERN.test(value)) {
    throw new Error('RUNNER_IMAGE_CANDIDATE_TTL_DAYS must be a positive integer.');
  }
  return Number(value);
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
