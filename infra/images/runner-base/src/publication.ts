import {readFileSync} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {parseArgs} from 'node:util';
import {
  CreateTagsCommand,
  DescribeImagesCommand,
  type DescribeImagesCommandOutput,
  DescribeSnapshotsCommand,
  type DescribeSnapshotsCommandOutput,
  EC2Client,
  type Image,
  type Snapshot,
  type Tag,
} from '@aws-sdk/client-ec2';
import {DescribeKeyCommand, type DescribeKeyCommandOutput, KMSClient} from '@aws-sdk/client-kms';
import {
  GetParameterCommand,
  type GetParameterCommandOutput,
  GetParametersCommand,
  type GetParametersCommandOutput,
  PutParameterCommand,
  SSMClient,
} from '@aws-sdk/client-ssm';
import {log} from '@shipfox/tool-utils';
import type {RunnerBaseBuildResult} from './build-runner-base.js';
import {
  parseRunnerBaseMetadata,
  RUNNER_BASE_API_VERSION,
  RUNNER_BASE_IMAGE_OS,
  RUNNER_BASE_POINTER_PARAMETER,
  RUNNER_BASE_REGION,
  RUNNER_BASE_TAGS,
  type RunnerBaseArchitecture,
  type RunnerBaseImage,
  type RunnerBaseMetadata,
  runnerBaseImageTags,
} from './metadata.js';
import {computeRunnerBaseRecipe} from './recipe.js';

export const CANONICAL_OWNER_ID = '099720109477';
export const CANONICAL_SOURCE_PARAMETERS: Record<RunnerBaseArchitecture, string> = {
  amd64: '/aws/service/canonical/ubuntu/server/noble/stable/current/amd64/hvm/ebs-gp3/ami-id',
  arm64: '/aws/service/canonical/ubuntu/server/noble/stable/current/arm64/hvm/ebs-gp3/ami-id',
};
/** A published pair older than this, measured from its older AMI, is neither reused nor published. */
export const RUNNER_BASE_MAX_AGE_DAYS = 7;

const ARCHITECTURES: readonly RunnerBaseArchitecture[] = ['amd64', 'arm64'];
const AWS_ARCHITECTURES: Record<RunnerBaseArchitecture, string> = {
  amd64: 'x86_64',
  arm64: 'arm64',
};
const AMI_ID_PATTERN = /^ami-[0-9a-f]{17}$/u;
const GIT_REVISION_PATTERN = /^[a-f0-9]{40}$/u;
const KMS_KEY_ARN_PATTERN =
  /^arn:aws:kms:([a-z]{2}(?:-gov)?-[a-z]+-\d):(\d{12}):key\/[0-9A-Za-z-]+$/u;
const DAY_MS = 24 * 60 * 60 * 1000;
const PARAMETER_NOT_FOUND = 'ParameterNotFound';

export interface Ec2ClientLike {
  send(command: DescribeImagesCommand): Promise<DescribeImagesCommandOutput>;
  send(command: DescribeSnapshotsCommand): Promise<DescribeSnapshotsCommandOutput>;
  send(command: CreateTagsCommand): Promise<unknown>;
}

export interface SsmClientLike {
  send(command: GetParameterCommand): Promise<GetParameterCommandOutput>;
  send(command: GetParametersCommand): Promise<GetParametersCommandOutput>;
  send(command: PutParameterCommand): Promise<unknown>;
}

export interface KmsClientLike {
  send(command: DescribeKeyCommand): Promise<DescribeKeyCommandOutput>;
}

export interface RunnerBaseClients {
  ec2: Ec2ClientLike;
  kms: KmsClientLike;
  ssm: SsmClientLike;
}

export interface CanonicalSource {
  architecture: RunnerBaseArchitecture;
  amiId: string;
  name: string;
  createdAt: string;
}

export type RunnerBasePlanReason =
  | 'forced'
  | 'missing'
  | 'invalid'
  | 'recipe-changed'
  | 'key-changed'
  | 'unavailable'
  | 'stale'
  | 'current';

export interface RunnerBasePlan {
  mode: 'build' | 'reuse';
  reason: RunnerBasePlanReason;
  detail: string;
  recipeDigest: string;
  kmsKeyArn: string;
  current: {generation: string; createdAt: string; ageDays: number} | null;
  sources: Record<RunnerBaseArchitecture, CanonicalSource> | null;
}

interface PlanOptions {
  clients: RunnerBaseClients;
  force: boolean;
  kmsKeyId: string;
  recipeDigest: string;
  now?: Date;
}

/**
 * Decides whether a new generation is needed. A compatible, available, and fresh pointer is
 * reused unless `force` is set. Canonical sources are resolved only when building, so both
 * architectures start from one pinned pair.
 */
export async function planRunnerBase(options: PlanOptions): Promise<RunnerBasePlan> {
  const {clients, force, recipeDigest} = options;
  const now = options.now ?? new Date();
  const kmsKeyArn = await resolveKmsKeyArn(clients.kms, options.kmsKeyId);
  const assessment = await assessCurrentBase({clients, kmsKeyArn, recipeDigest, now});
  const decision = force
    ? {mode: 'build' as const, reason: 'forced' as const, detail: 'A new generation was requested.'}
    : {
        mode: assessment.reason === 'current' ? ('reuse' as const) : ('build' as const),
        reason: assessment.reason,
        detail: assessment.detail,
      };
  const sources =
    decision.mode === 'build' ? await resolveCanonicalSources(clients.ssm, clients.ec2) : null;
  return {...decision, recipeDigest, kmsKeyArn, current: assessment.current, sources};
}

interface CurrentBaseAssessment {
  reason: Exclude<RunnerBasePlanReason, 'forced'>;
  detail: string;
  current: RunnerBasePlan['current'];
}

async function assessCurrentBase(options: {
  clients: RunnerBaseClients;
  kmsKeyArn: string;
  recipeDigest: string;
  now: Date;
}): Promise<CurrentBaseAssessment> {
  const {clients, kmsKeyArn, recipeDigest, now} = options;
  const raw = await readRunnerBasePointer(clients.ssm);
  if (raw === null) {
    return {
      reason: 'missing',
      detail: `${RUNNER_BASE_POINTER_PARAMETER} is not set.`,
      current: null,
    };
  }
  let metadata: RunnerBaseMetadata;
  try {
    metadata = parseRunnerBaseMetadata(JSON.parse(raw));
  } catch (error) {
    return {reason: 'invalid', detail: errorMessage(error), current: null};
  }

  const createdAt = pairCreatedAt(metadata.images);
  const ageDays = (now.getTime() - Date.parse(createdAt)) / DAY_MS;
  const current = {generation: metadata.generation, createdAt, ageDays};
  if (metadata.recipeDigest !== recipeDigest) {
    return {
      reason: 'recipe-changed',
      detail: `Published recipe ${metadata.recipeDigest} differs from ${recipeDigest}.`,
      current,
    };
  }
  if (metadata.kmsKeyArn !== kmsKeyArn) {
    return {
      reason: 'key-changed',
      detail: `Published key ${metadata.kmsKeyArn} differs from ${kmsKeyArn}.`,
      current,
    };
  }
  if (ageDays > RUNNER_BASE_MAX_AGE_DAYS) {
    return {
      reason: 'stale',
      detail: `The older image is ${ageDays.toFixed(2)} days old; the limit is ${RUNNER_BASE_MAX_AGE_DAYS}.`,
      current,
    };
  }
  try {
    for (const image of metadata.images) {
      const published = await describeOwnedImage(clients.ec2, image.amiId);
      checkImageTags(published, {
        architecture: image.architecture,
        generation: metadata.generation,
        recipeDigest: metadata.recipeDigest,
        revision: metadata.sourceRevision,
        status: 'verified',
      });
    }
  } catch (error) {
    return {reason: 'unavailable', detail: errorMessage(error), current};
  }
  return {reason: 'current', detail: `Generation ${metadata.generation} is compatible.`, current};
}

export async function resolveKmsKeyArn(kms: KmsClientLike, keyId: string): Promise<string> {
  const {KeyMetadata: key} = await kms.send(new DescribeKeyCommand({KeyId: keyId}));
  const arn = key?.Arn;
  const match = arn ? KMS_KEY_ARN_PATTERN.exec(arn) : null;
  if (!arn || !match) throw new Error(`KMS key ${keyId} did not resolve to a key ARN.`);
  if (match[1] !== RUNNER_BASE_REGION) {
    throw new Error(`KMS key ${arn} is not in ${RUNNER_BASE_REGION}.`);
  }
  if (key.KeyState !== 'Enabled') throw new Error(`KMS key ${arn} is ${key.KeyState}.`);
  return arn;
}

export async function resolveCanonicalSources(
  ssm: SsmClientLike,
  ec2: Ec2ClientLike,
): Promise<Record<RunnerBaseArchitecture, CanonicalSource>> {
  const names = ARCHITECTURES.map((architecture) => CANONICAL_SOURCE_PARAMETERS[architecture]);
  const output = await ssm.send(new GetParametersCommand({Names: names}));
  if (output.InvalidParameters?.length) {
    throw new Error(
      `Canonical source parameters are missing: ${output.InvalidParameters.join(', ')}.`,
    );
  }
  const amiIds = ARCHITECTURES.map((architecture) => {
    const name = CANONICAL_SOURCE_PARAMETERS[architecture];
    const value = output.Parameters?.find((parameter) => parameter.Name === name)?.Value;
    if (!value || !AMI_ID_PATTERN.test(value)) {
      throw new Error(
        `Canonical source parameter ${name} is not an AMI ID: ${value ?? 'missing'}.`,
      );
    }
    return value;
  });

  const {Images: images = []} = await ec2.send(new DescribeImagesCommand({ImageIds: amiIds}));
  const [amd64, arm64] = ARCHITECTURES.map((architecture, index) =>
    canonicalSource(
      architecture,
      images.find((image) => image.ImageId === amiIds[index]),
      amiIds[index] as string,
    ),
  );
  return {amd64: amd64 as CanonicalSource, arm64: arm64 as CanonicalSource};
}

function canonicalSource(
  architecture: RunnerBaseArchitecture,
  image: Image | undefined,
  amiId: string,
): CanonicalSource {
  if (!image) throw new Error(`Canonical ${architecture} source ${amiId} was not found.`);
  const problem = canonicalSourceProblem(architecture, image);
  if (problem) throw new Error(`Canonical ${architecture} source ${amiId} ${problem}.`);
  return {
    architecture,
    amiId,
    name: image.Name as string,
    createdAt: timestamp(image.CreationDate, `Canonical source ${amiId} creation time`),
  };
}

function canonicalSourceProblem(architecture: RunnerBaseArchitecture, image: Image): string | null {
  const namePrefix = `ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-${architecture}-server-`;
  if (image.OwnerId !== CANONICAL_OWNER_ID) {
    return `is owned by ${image.OwnerId ?? 'an unknown account'}, not Canonical`;
  }
  if (image.Architecture !== AWS_ARCHITECTURES[architecture]) {
    return `has architecture ${image.Architecture ?? 'unknown'}`;
  }
  if (!image.Name?.startsWith(namePrefix)) {
    return `is not an Ubuntu 24.04 ${architecture} server image (${image.Name ?? 'unnamed'})`;
  }
  if (image.State !== 'available') return `is ${image.State ?? 'in an unknown state'}`;
  if (image.RootDeviceType !== 'ebs') return 'is not EBS-backed';
  return null;
}

export async function readRunnerBasePointer(ssm: SsmClientLike): Promise<string | null> {
  try {
    const output = await ssm.send(new GetParameterCommand({Name: RUNNER_BASE_POINTER_PARAMETER}));
    return output.Parameter?.Value ?? null;
  } catch (error) {
    if (awsErrorName(error) === PARAMETER_NOT_FOUND) return null;
    throw error;
  }
}

interface PublishOptions {
  clients: RunnerBaseClients;
  results: RunnerBaseBuildResult[];
  kmsKeyId: string;
  /** Recipe digest of trusted main's current base package. */
  trustedRecipeDigest: string;
  buildUrl: string;
  now?: Date;
}

export interface RunnerBasePublication {
  status: 'published' | 'already-published';
  metadata: RunnerBaseMetadata;
}

/**
 * Verifies a built pair, reconciles its `verified` tags, and then writes the single pointer.
 * Any failure leaves the previous pointer in place. Re-running after a partial failure repeats
 * the tag writes, which are idempotent.
 */
export async function publishRunnerBase(options: PublishOptions): Promise<RunnerBasePublication> {
  const {clients} = options;
  const now = options.now ?? new Date();
  const build = checkBuildResults(options.results);
  if (build.recipeDigest !== options.trustedRecipeDigest) {
    throw new Error(
      `Generation ${build.generation} uses recipe ${build.recipeDigest}, but main now expects ${options.trustedRecipeDigest}. An obsolete checkout cannot replace the base.`,
    );
  }
  const kmsKeyArn = await resolveKmsKeyArn(clients.kms, options.kmsKeyId);

  const images: RunnerBaseImage[] = [];
  const owners = new Set<string>();
  for (const result of build.results) {
    const image = await describeOwnedImage(clients.ec2, result.amiId);
    checkImageTags(image, {...tagIdentity(build, result.architecture), status: undefined});
    await checkSnapshotEncryption(clients.ec2, image, kmsKeyArn);
    owners.add(image.OwnerId as string);
    images.push({
      architecture: result.architecture,
      amiId: result.amiId,
      sourceAmiId: result.sourceAmiId,
      createdAt: timestamp(image.CreationDate, `Runner base ${result.amiId} creation time`),
    });
  }
  if (owners.size !== 1) throw new Error('Runner base images belong to different accounts.');

  const metadata = parseRunnerBaseMetadata({
    apiVersion: RUNNER_BASE_API_VERSION,
    generation: build.generation,
    recipeDigest: build.recipeDigest,
    sourceRevision: build.revision,
    buildUrl: options.buildUrl,
    createdAt: pairCreatedAt(images),
    verifiedAt: latest(build.results.map((result) => result.verifiedAt)),
    owner: [...owners][0],
    region: build.region,
    kmsKeyArn,
    imageOs: RUNNER_BASE_IMAGE_OS,
    images,
  });
  const ageDays = (now.getTime() - Date.parse(metadata.createdAt)) / DAY_MS;
  if (ageDays > RUNNER_BASE_MAX_AGE_DAYS) {
    throw new Error(
      `Generation ${build.generation} is ${ageDays.toFixed(2)} days old; the limit is ${RUNNER_BASE_MAX_AGE_DAYS}.`,
    );
  }

  for (const result of build.results) {
    await markVerified(clients.ec2, build, result.architecture, result.amiId);
  }
  return writePointer(clients.ssm, metadata);
}

async function markVerified(
  ec2: Ec2ClientLike,
  build: CheckedBuild,
  architecture: RunnerBaseArchitecture,
  amiId: string,
): Promise<void> {
  const identity = {...tagIdentity(build, architecture), status: 'verified' as const};
  const image = await describeOwnedImage(ec2, amiId);
  const snapshotIds = imageSnapshotIds(image);
  await ec2.send(
    new CreateTagsCommand({
      Resources: [amiId, ...snapshotIds],
      Tags: Object.entries(runnerBaseImageTags(identity)).map(([Key, Value]) => ({Key, Value})),
    }),
  );

  checkImageTags(await describeOwnedImage(ec2, amiId), identity);
  for (const snapshot of await describeSnapshots(ec2, snapshotIds)) {
    checkTags(snapshot.Tags, identity, `Runner base snapshot ${snapshot.SnapshotId}`);
  }
}

async function writePointer(
  ssm: SsmClientLike,
  metadata: RunnerBaseMetadata,
): Promise<RunnerBasePublication> {
  const current = parsePublishedPointer(await readRunnerBasePointer(ssm));
  if (current?.generation === metadata.generation) {
    return {status: 'already-published', metadata: current};
  }
  if (current && Date.parse(current.createdAt) > Date.parse(metadata.createdAt)) {
    throw new Error(
      `The published generation ${current.generation} is newer than ${metadata.generation}.`,
    );
  }

  await ssm.send(
    new PutParameterCommand({
      Name: RUNNER_BASE_POINTER_PARAMETER,
      Value: JSON.stringify(metadata),
      Type: 'String',
      Overwrite: true,
    }),
  );
  const written = parsePublishedPointer(await readRunnerBasePointer(ssm));
  if (written?.generation !== metadata.generation) {
    throw new Error(`${RUNNER_BASE_POINTER_PARAMETER} did not read back ${metadata.generation}.`);
  }
  return {status: 'published', metadata};
}

// An unreadable pointer does not block replacing it with a valid generation.
function parsePublishedPointer(raw: string | null): RunnerBaseMetadata | null {
  if (raw === null) return null;
  try {
    return parseRunnerBaseMetadata(JSON.parse(raw));
  } catch (error) {
    log.info(`Replacing an invalid runner base pointer: ${errorMessage(error)}`);
    return null;
  }
}

interface CheckedBuild {
  generation: string;
  recipeDigest: string;
  region: string;
  revision: string;
  results: RunnerBaseBuildResult[];
}

function checkBuildResults(results: RunnerBaseBuildResult[]): CheckedBuild {
  const sorted = [...results].sort((a, b) => a.architecture.localeCompare(b.architecture));
  if (sorted.length !== 2 || sorted.some((result, i) => result.architecture !== ARCHITECTURES[i])) {
    throw new Error('Publication requires exactly one amd64 and one arm64 build result.');
  }
  const [first] = sorted as [RunnerBaseBuildResult, RunnerBaseBuildResult];
  for (const field of ['generation', 'recipeDigest', 'revision', 'region', 'imageOs'] as const) {
    if (sorted.some((result) => result[field] !== first[field])) {
      throw new Error(`Build results disagree on ${field}.`);
    }
  }
  if (!GIT_REVISION_PATTERN.test(first.revision)) {
    throw new Error('Published bases require a full lowercase Git revision.');
  }
  return {
    generation: first.generation,
    recipeDigest: first.recipeDigest,
    region: first.region,
    revision: first.revision,
    results: sorted,
  };
}

export function parseRunnerBaseBuildResult(value: unknown, label: string): RunnerBaseBuildResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const result = value as Record<string, unknown>;
  const fields = [
    'architecture',
    'amiId',
    'builtAt',
    'generation',
    'imageOs',
    'recipeDigest',
    'region',
    'revision',
    'sourceAmiId',
    'verifiedAt',
  ] as const;
  for (const field of fields) {
    if (typeof result[field] !== 'string' || !result[field]) {
      throw new Error(`${label} ${field} must be a non-empty string.`);
    }
  }
  if (!ARCHITECTURES.includes(result.architecture as RunnerBaseArchitecture)) {
    throw new Error(`${label} architecture must be amd64 or arm64.`);
  }
  if (!AMI_ID_PATTERN.test(result.amiId as string)) {
    throw new Error(`${label} amiId must be an AMI ID.`);
  }
  return result as unknown as RunnerBaseBuildResult;
}

interface ExpectedTags {
  architecture: RunnerBaseArchitecture;
  generation: string;
  recipeDigest: string;
  revision: string;
  /** Omit to accept either status, such as a base marked verified by an earlier attempt. */
  status: 'verified' | undefined;
}

function tagIdentity(
  build: CheckedBuild,
  architecture: RunnerBaseArchitecture,
): Omit<ExpectedTags, 'status'> {
  return {
    architecture,
    generation: build.generation,
    recipeDigest: build.recipeDigest,
    revision: build.revision,
  };
}

function checkImageTags(image: Image, expected: ExpectedTags): void {
  checkTags(image.Tags, expected, `Runner base AMI ${image.ImageId}`);
}

function checkTags(tags: Tag[] | undefined, expected: ExpectedTags, label: string): void {
  const actual = new Map((tags ?? []).map((tag) => [tag.Key, tag.Value]));
  const required = runnerBaseImageTags({...expected, status: expected.status ?? 'building'});
  const mismatches = Object.entries(required)
    .filter(([key]) => expected.status || key !== RUNNER_BASE_TAGS.status)
    .filter(([key, value]) => actual.get(key) !== value)
    .map(([key, value]) => `${key}=${actual.get(key) ?? '<missing>'} (expected ${value})`);
  if (mismatches.length) {
    throw new Error(`${label} has unexpected tags: ${mismatches.join(', ')}.`);
  }
}

async function describeOwnedImage(ec2: Ec2ClientLike, amiId: string): Promise<Image> {
  const {Images: images = []} = await ec2.send(
    new DescribeImagesCommand({Owners: ['self'], ImageIds: [amiId]}),
  );
  const image = images.find((candidate) => candidate.ImageId === amiId);
  if (!image) throw new Error(`Runner base AMI ${amiId} was not found in this account.`);
  if (image.State !== 'available') {
    throw new Error(`Runner base AMI ${amiId} is ${image.State ?? 'in an unknown state'}.`);
  }
  if (!image.OwnerId) throw new Error(`Runner base AMI ${amiId} has no owner.`);
  return image;
}

function imageSnapshotIds(image: Image): string[] {
  const ids = (image.BlockDeviceMappings ?? []).flatMap((mapping) =>
    mapping.Ebs?.SnapshotId ? [mapping.Ebs.SnapshotId] : [],
  );
  if (!ids.length) throw new Error(`Runner base AMI ${image.ImageId} has no EBS snapshots.`);
  return ids;
}

async function describeSnapshots(ec2: Ec2ClientLike, snapshotIds: string[]): Promise<Snapshot[]> {
  const {Snapshots: snapshots = []} = await ec2.send(
    new DescribeSnapshotsCommand({OwnerIds: ['self'], SnapshotIds: snapshotIds}),
  );
  for (const snapshotId of snapshotIds) {
    if (!snapshots.some((snapshot) => snapshot.SnapshotId === snapshotId)) {
      throw new Error(`Runner base snapshot ${snapshotId} was not found in this account.`);
    }
  }
  return snapshots;
}

// Derived candidates share snapshot blocks with the base only under the same key.
async function checkSnapshotEncryption(
  ec2: Ec2ClientLike,
  image: Image,
  kmsKeyArn: string,
): Promise<void> {
  for (const snapshot of await describeSnapshots(ec2, imageSnapshotIds(image))) {
    if (!snapshot.Encrypted || snapshot.KmsKeyId !== kmsKeyArn) {
      throw new Error(
        `Runner base snapshot ${snapshot.SnapshotId} is not encrypted with ${kmsKeyArn} (found ${snapshot.KmsKeyId ?? 'no key'}).`,
      );
    }
  }
}

// Pair freshness follows the older image, so a later verification cannot make it look newer.
function pairCreatedAt(images: RunnerBaseImage[]): string {
  return new Date(Math.min(...images.map((image) => Date.parse(image.createdAt)))).toISOString();
}

function latest(values: string[]): string {
  return new Date(Math.max(...values.map((value) => Date.parse(value)))).toISOString();
}

function timestamp(value: string | Date | undefined, label: string): string {
  if (!value) throw new Error(`${label} is missing.`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} is not a valid timestamp.`);
  return parsed.toISOString();
}

function awsErrorName(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const name = (error as {name?: unknown}).name;
  return typeof name === 'string' ? name : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function defaultClients(): RunnerBaseClients {
  const region = RUNNER_BASE_REGION;
  return {
    ec2: new EC2Client({region}),
    kms: new KMSClient({region}),
    ssm: new SSMClient({region}),
  };
}

function kmsKeyIdFromEnv(env: NodeJS.ProcessEnv): string {
  const keyId = env.BUILD_CANDIDATE_KMS_KEY_ID ?? env.AWS_RUNNER_IMAGE_CANDIDATE_KMS_KEY_ID;
  if (!keyId) throw new Error('BUILD_CANDIDATE_KMS_KEY_ID is not set.');
  return keyId;
}

export function runPlanRunnerBaseCli(args = process.argv.slice(2), env = process.env): void {
  const {values} = parseArgs({
    args,
    strict: true,
    options: {output: {type: 'string'}, force: {type: 'boolean', default: false}},
  });
  const outputPath = values.output;
  if (!outputPath) throw new Error('Usage: plan-runner-base --output <path> [--force]');

  planRunnerBase({
    clients: defaultClients(),
    force: values.force,
    kmsKeyId: kmsKeyIdFromEnv(env),
    recipeDigest: computeRunnerBaseRecipe().digest,
  })
    .then(async (plan) => {
      await writeFile(outputPath, `${JSON.stringify(plan, null, 2)}\n`);
      log.info(`Runner base plan: ${plan.mode} (${plan.reason}). ${plan.detail}`);
    })
    .catch((error: unknown) => {
      log.error(String(error));
      process.exitCode = 1;
    });
}

export function runPublishRunnerBaseCli(args = process.argv.slice(2), env = process.env): void {
  const {values} = parseArgs({
    args,
    strict: true,
    options: {
      result: {type: 'string', multiple: true},
      'trusted-root': {type: 'string'},
      'build-url': {type: 'string'},
      output: {type: 'string'},
    },
  });
  const trustedRoot = values['trusted-root'];
  const buildUrl = values['build-url'];
  const outputPath = values.output;
  if (!values.result?.length || !trustedRoot || !buildUrl || !outputPath) {
    throw new Error(
      'Usage: publish-runner-base --result <path> --result <path> --trusted-root <checkout> --build-url <url> --output <path>',
    );
  }

  const results = values.result.map((path) =>
    parseRunnerBaseBuildResult(JSON.parse(readFileSync(path, 'utf8')), path),
  );
  // Trusted main's files decide the expected recipe, so a run that started before a recipe
  // change on main cannot publish the obsolete recipe.
  const trustedRecipeDigest = computeRunnerBaseRecipe({
    packageRoot: join(trustedRoot, 'infra/images/runner-base'),
    miseConfigPath: join(trustedRoot, 'mise.toml'),
  }).digest;

  publishRunnerBase({
    clients: defaultClients(),
    results,
    kmsKeyId: kmsKeyIdFromEnv(env),
    trustedRecipeDigest,
    buildUrl,
  })
    .then(async (publication) => {
      await writeFile(outputPath, `${JSON.stringify(publication, null, 2)}\n`);
      log.info(`Runner base ${publication.metadata.generation} ${publication.status}.`);
    })
    .catch((error: unknown) => {
      log.error(String(error));
      process.exitCode = 1;
    });
}
