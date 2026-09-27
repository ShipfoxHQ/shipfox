import {writeFile} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import {DescribeImagesCommand, type Image} from '@aws-sdk/client-ec2';
import {log} from '@shipfox/tool-utils';
import {RUNNER_BASE_LIFECYCLE, RUNNER_BASE_TAGS, type RunnerBaseArchitecture} from './metadata.js';
import {
  assessCurrentBase,
  checkImageIdentity,
  checkSnapshotEncryption,
  type DescribeImagesClient,
  defaultClients,
  describeOwnedImage,
  kmsKeyIdFromEnv,
  pairCreatedAt,
  RUNNER_BASE_MAX_AGE_DAYS,
  type RunnerBaseClients,
  type RunnerBasePlanReason,
  resolveKmsKeyArn,
} from './publication.js';
import {computeRunnerBaseRecipe} from './recipe.js';

/** Candidate builds warn about a base older than this but still accept it. */
export const RUNNER_BASE_WARN_AGE_DAYS = 2;
/**
 * A selection must launch within this window. With the seven-day selection limit, no build
 * launches from a base older than eight days, which base retention's nine-day minimum relies on.
 */
export const RUNNER_BASE_SELECTION_TTL_DAYS = 1;

const ARCHITECTURES: readonly RunnerBaseArchitecture[] = ['amd64', 'arm64'];
const AMI_ID_PATTERN = /^ami-[0-9a-f]{17}$/u;
const ACCOUNT_ID_PATTERN = /^\d{12}$/u;
const GENERATION_PATTERN = /^[A-Za-z0-9._-]+$/u;
const RECIPE_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const KMS_KEY_ARN_PATTERN = /^arn:aws:kms:[a-z]{2}(?:-gov)?-[a-z]+-\d:\d{12}:key\/[0-9A-Za-z-]+$/u;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RunnerBaseSelectionImage {
  architecture: RunnerBaseArchitecture;
  amiId: string;
  createdAt: string;
}

/** One verified generation chosen for both architectures of a candidate build. */
export interface RunnerBaseSelection {
  generation: string;
  recipeDigest: string;
  kmsKeyArn: string;
  owner: string;
  /** Creation time of the older AMI, which sets the pair's age. */
  createdAt: string;
  selectedAt: string;
  images: RunnerBaseSelectionImage[];
}

export class RunnerBaseSelectionError extends Error {
  constructor(
    readonly reason: Exclude<RunnerBasePlanReason, 'forced' | 'current'>,
    message: string,
  ) {
    super(message);
    this.name = 'RunnerBaseSelectionError';
  }
}

interface SelectOptions {
  clients: RunnerBaseClients;
  kmsKeyId: string;
  recipeDigest: string;
  /**
   * Selects this generation from its AMI tags instead of the pointer. A partial candidate pair
   * completes from the generation its surviving image recorded.
   */
  generation?: string;
  now?: Date;
}

/**
 * Selects one compatible, verified, and fresh base generation. Throws a
 * `RunnerBaseSelectionError` when none is acceptable.
 */
export async function selectRunnerBase(options: SelectOptions): Promise<RunnerBaseSelection> {
  const now = options.now ?? new Date();
  const kmsKeyArn = await resolveKmsKeyArn(options.clients.kms, options.kmsKeyId);
  const selection = options.generation
    ? await selectTaggedGeneration({...options, generation: options.generation, kmsKeyArn, now})
    : await selectPointer({...options, kmsKeyArn, now});
  return {...selection, selectedAt: now.toISOString()};
}

type UntimedSelection = Omit<RunnerBaseSelection, 'selectedAt'>;

async function selectPointer(options: {
  clients: RunnerBaseClients;
  kmsKeyArn: string;
  recipeDigest: string;
  now: Date;
}): Promise<UntimedSelection> {
  const assessment = await assessCurrentBase(options);
  if (assessment.reason !== 'current') {
    throw new RunnerBaseSelectionError(assessment.reason, assessment.detail);
  }
  const {metadata} = assessment;
  return {
    generation: metadata.generation,
    recipeDigest: metadata.recipeDigest,
    kmsKeyArn: metadata.kmsKeyArn,
    owner: metadata.owner,
    createdAt: pairCreatedAt(metadata.images),
    images: ARCHITECTURES.map((architecture) => {
      const image = metadata.images.find((item) => item.architecture === architecture);
      if (!image) throw new Error(`Runner base metadata has no ${architecture} image.`);
      return {architecture, amiId: image.amiId, createdAt: image.createdAt};
    }),
  };
}

async function selectTaggedGeneration(options: {
  clients: RunnerBaseClients;
  generation: string;
  kmsKeyArn: string;
  recipeDigest: string;
  now: Date;
}): Promise<UntimedSelection> {
  const {clients, generation, kmsKeyArn, recipeDigest, now} = options;
  const {Images: found = []} = await clients.ec2.send(
    new DescribeImagesCommand({
      Owners: ['self'],
      Filters: [
        {Name: `tag:${RUNNER_BASE_TAGS.managed}`, Values: ['true']},
        {Name: `tag:${RUNNER_BASE_TAGS.lifecycle}`, Values: [RUNNER_BASE_LIFECYCLE]},
        {Name: `tag:${RUNNER_BASE_TAGS.generation}`, Values: [generation]},
        {Name: 'state', Values: ['available']},
      ],
    }),
  );

  const owners = new Set(found.map((image) => image.OwnerId));
  const [owner] = owners;
  if (owners.size !== 1 || !owner) {
    throw new RunnerBaseSelectionError(
      'unavailable',
      `Runner base generation ${generation} has no single owner account.`,
    );
  }
  const images: RunnerBaseSelectionImage[] = [];
  for (const architecture of ARCHITECTURES) {
    const matches = found.filter(
      (image) => tagValue(image, RUNNER_BASE_TAGS.architecture) === architecture,
    );
    const [image] = matches;
    if (matches.length !== 1 || !image) {
      throw new RunnerBaseSelectionError(
        'unavailable',
        `Runner base generation ${generation} has ${matches.length} available ${architecture} AMIs.`,
      );
    }
    checkImageIdentity(image, architecture, owner);
    if (tagValue(image, RUNNER_BASE_TAGS.recipe) !== recipeDigest) {
      throw new RunnerBaseSelectionError(
        'recipe-changed',
        `Runner base ${image.ImageId} uses recipe ${tagValue(image, RUNNER_BASE_TAGS.recipe) ?? '<missing>'}, not ${recipeDigest}.`,
      );
    }
    if (tagValue(image, RUNNER_BASE_TAGS.status) !== 'verified') {
      throw new RunnerBaseSelectionError(
        'unavailable',
        `Runner base ${image.ImageId} is not marked verified.`,
      );
    }
    try {
      await checkSnapshotEncryption(clients.ec2, image, kmsKeyArn);
    } catch (error) {
      throw new RunnerBaseSelectionError('key-changed', errorMessage(error));
    }
    images.push({
      architecture,
      amiId: image.ImageId as string,
      createdAt: timestamp(image.CreationDate, `Runner base ${image.ImageId} creation time`),
    });
  }

  const createdAt = pairCreatedAt(images);
  const ageDays = (now.getTime() - Date.parse(createdAt)) / DAY_MS;
  if (ageDays > RUNNER_BASE_MAX_AGE_DAYS) {
    throw new RunnerBaseSelectionError(
      'stale',
      `Runner base generation ${generation} is ${ageDays.toFixed(2)} days old; the limit is ${RUNNER_BASE_MAX_AGE_DAYS}.`,
    );
  }
  return {generation, recipeDigest, kmsKeyArn, owner, createdAt, images};
}

/** Age of the selected pair, in days, when it was selected. */
export function runnerBaseSelectionAgeDays(selection: RunnerBaseSelection): number {
  return (Date.parse(selection.selectedAt) - Date.parse(selection.createdAt)) / DAY_MS;
}

export function runnerBaseSelectionWarning(selection: RunnerBaseSelection): string | null {
  const ageDays = runnerBaseSelectionAgeDays(selection);
  if (ageDays <= RUNNER_BASE_WARN_AGE_DAYS) return null;
  return `Runner base generation ${selection.generation} is ${ageDays.toFixed(2)} days old. Check the scheduled Publish runner base workflow.`;
}

/**
 * Rechecks one selected base AMI immediately before a build launches from it. A selection older
 * than one day must be made again, so a delayed or re-run build cannot start from a base that
 * retention may already delete.
 */
export async function revalidateRunnerBaseImage(options: {
  ec2: DescribeImagesClient;
  selection: RunnerBaseSelection;
  architecture: RunnerBaseArchitecture;
  now?: Date;
}): Promise<RunnerBaseSelectionImage> {
  const {ec2, selection, architecture} = options;
  const now = options.now ?? new Date();
  const selectionAgeDays = (now.getTime() - Date.parse(selection.selectedAt)) / DAY_MS;
  if (!(selectionAgeDays >= 0) || selectionAgeDays > RUNNER_BASE_SELECTION_TTL_DAYS) {
    throw new Error(
      `The runner base selection from ${selection.selectedAt} is more than ${RUNNER_BASE_SELECTION_TTL_DAYS} day old. Re-run all jobs to select a base again.`,
    );
  }
  if (runnerBaseSelectionAgeDays(selection) > RUNNER_BASE_MAX_AGE_DAYS) {
    throw new Error(
      `Runner base generation ${selection.generation} was older than ${RUNNER_BASE_MAX_AGE_DAYS} days when selected.`,
    );
  }
  const selected = selection.images.find((image) => image.architecture === architecture);
  if (!selected) {
    throw new Error(`Runner base generation ${selection.generation} has no ${architecture} AMI.`);
  }

  const image = await describeOwnedImage(ec2, selected.amiId);
  checkImageIdentity(image, architecture, selection.owner);
  const expected = {
    [RUNNER_BASE_TAGS.managed]: 'true',
    [RUNNER_BASE_TAGS.lifecycle]: RUNNER_BASE_LIFECYCLE,
    [RUNNER_BASE_TAGS.architecture]: architecture,
    [RUNNER_BASE_TAGS.generation]: selection.generation,
    [RUNNER_BASE_TAGS.recipe]: selection.recipeDigest,
    [RUNNER_BASE_TAGS.status]: 'verified',
  };
  const mismatches = Object.entries(expected)
    .filter(([key, value]) => tagValue(image, key) !== value)
    .map(([key, value]) => `${key}=${tagValue(image, key) ?? '<missing>'} (expected ${value})`);
  if (mismatches.length) {
    throw new Error(
      `Runner base AMI ${selected.amiId} has unexpected tags: ${mismatches.join(', ')}.`,
    );
  }
  return selected;
}

export function parseRunnerBaseSelection(value: unknown): RunnerBaseSelection {
  const selection = object(value, 'Runner base selection');
  const images = selection.images;
  if (!Array.isArray(images) || images.length !== ARCHITECTURES.length) {
    throw new Error('Runner base selection must name exactly one amd64 and one arm64 AMI.');
  }
  const parsedImages = ARCHITECTURES.map((architecture) => {
    const matches = images.filter(
      (image) => object(image, 'Runner base selection image').architecture === architecture,
    );
    const [image] = matches;
    if (matches.length !== 1 || !image) {
      throw new Error('Runner base selection must name exactly one amd64 and one arm64 AMI.');
    }
    return {
      architecture,
      amiId: matching(image.amiId, AMI_ID_PATTERN, `Runner base ${architecture} amiId`),
      createdAt: timestamp(image.createdAt, `Runner base ${architecture} createdAt`),
    };
  });
  return {
    generation: matching(selection.generation, GENERATION_PATTERN, 'Runner base generation'),
    recipeDigest: matching(selection.recipeDigest, RECIPE_DIGEST_PATTERN, 'Runner base recipe'),
    kmsKeyArn: matching(selection.kmsKeyArn, KMS_KEY_ARN_PATTERN, 'Runner base kmsKeyArn'),
    owner: matching(selection.owner, ACCOUNT_ID_PATTERN, 'Runner base owner'),
    createdAt: timestamp(selection.createdAt, 'Runner base createdAt'),
    selectedAt: timestamp(selection.selectedAt, 'Runner base selectedAt'),
    images: parsedImages,
  };
}

function tagValue(image: Image, key: string): string | undefined {
  return image.Tags?.find((tag) => tag.Key === key)?.Value;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function matching(value: unknown, pattern: RegExp, label: string): string {
  if (typeof value !== 'string' || !pattern.test(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function timestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' && !(value instanceof Date))
    throw new Error(`${label} is missing.`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} is not a valid timestamp.`);
  return parsed.toISOString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Selects a base for this checkout's recipe with AWS clients and the candidate key from `env`. */
export function selectRunnerBaseForCheckout(
  options: {generation?: string | undefined; env?: NodeJS.ProcessEnv} = {},
): Promise<RunnerBaseSelection> {
  return selectRunnerBase({
    clients: defaultClients(),
    kmsKeyId: kmsKeyIdFromEnv(options.env ?? process.env),
    recipeDigest: computeRunnerBaseRecipe().digest,
    ...(options.generation ? {generation: options.generation} : {}),
  });
}

export function runSelectRunnerBaseCli(args = process.argv.slice(2), env = process.env): void {
  const {values} = parseArgs({args, strict: true, options: {output: {type: 'string'}}});
  const outputPath = values.output;
  if (!outputPath) throw new Error('Usage: select-runner-base --output <path>');

  selectRunnerBaseForCheckout({env})
    .then(async (selection) => {
      await writeFile(outputPath, `${JSON.stringify(selection, null, 2)}\n`);
      const warning = runnerBaseSelectionWarning(selection);
      // The tool-utils Log type has no warning level, so write the annotation directly.
      if (warning) process.stdout.write(`::warning::${warning}\n`);
      log.info(`Selected runner base generation ${selection.generation}.`);
    })
    .catch((error: unknown) => {
      log.error(String(error));
      process.exitCode = 1;
    });
}
