import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {DescribeImagesCommand, EC2Client, type Image} from '@aws-sdk/client-ec2';
import {log} from '@shipfox/tool-utils';

const CANDIDATE_REGION = 'eu-central-1';
const FRESHNESS_DAYS = 5;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const AMI_ID_PATTERN = /^ami-[0-9a-f]{17}$/u;
const GIT_REVISION_PATTERN = /^[0-9a-f]{40}$/u;
const ARCHITECTURES = ['amd64', 'arm64'] as const;

const ROOT_EFFECTIVE_INPUTS = [
  '.github/actions/setup-mise/action.yml',
  '.github/actions/setup-pnpm/action.yml',
  '.github/workflows/ci.yml',
  '.github/workflows/publish-runner-image-candidate.yml',
  'mise.lock',
  'mise.toml',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'turbo.jsonc',
] as const;

const BUILD_TOOL_DIRECTORIES = ['tools/swc', 'tools/utils'] as const;

export type CandidatePlannerMode = 'build' | 'reuse-current' | 'skip-recent';

export interface PlannedCandidateImage {
  amiId: string;
  architecture: (typeof ARCHITECTURES)[number];
  createdAt: string;
}

export interface PlannedCandidatePair {
  revision: string;
  images: PlannedCandidateImage[];
}

export interface CandidatePlannerResult {
  mode: CandidatePlannerMode;
  reason: string;
  detail: string;
  currentRevision: string;
  priorPair: PlannedCandidatePair | null;
  candidateAgeDays: number | null;
  effectiveChanges: string[];
}

export interface WorkspaceManifest {
  path: string;
  name: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface CandidateInventoryClient {
  send(command: DescribeImagesCommand): Promise<{Images?: Image[]; NextToken?: string}>;
}

interface CandidatePlannerDependencies {
  listImages?: () => Promise<Image[]>;
  resolveEffectiveDirectories?: () => string[];
  isAncestor?: (base: string, head: string) => boolean;
  listChangedFiles?: (base: string, head: string) => string[];
}

interface CandidatePlannerOptions {
  currentRevision: string;
  force: boolean;
  now?: Date;
}

interface InventorySelection {
  currentPair: PlannedCandidatePair | null;
  newestPriorPair: PlannedCandidatePair | null;
  newestGroupIsPartial: boolean;
}

export async function planRunnerImageCandidate(
  options: CandidatePlannerOptions,
  dependencies: CandidatePlannerDependencies = {},
): Promise<CandidatePlannerResult> {
  const baseResult = {
    currentRevision: options.currentRevision,
    effectiveChanges: [],
  };

  try {
    requireRevision(options.currentRevision, 'Current revision');
    const images = await (dependencies.listImages ?? listCandidateImages)();
    const inventory = inspectCandidateInventory(images, options.currentRevision);
    const now = options.now ?? new Date();
    const inventoryDecision = decideFromInventory(options, inventory, now);
    if (inventoryDecision) return inventoryDecision;

    const priorPair = requiredPriorPair(inventory);

    const isAncestor = dependencies.isAncestor ?? gitIsAncestor;
    if (!isAncestor(priorPair.revision, options.currentRevision)) {
      return {
        ...baseResult,
        mode: 'build',
        reason: 'prior-not-ancestor',
        detail:
          'The newest complete candidate revision is not an ancestor of the current revision.',
        priorPair,
        candidateAgeDays: pairAgeDays(priorPair, now),
      };
    }

    const effectiveDirectories = (
      dependencies.resolveEffectiveDirectories ?? resolveRunnerEffectiveDirectories
    )();
    const changedFiles = (dependencies.listChangedFiles ?? gitChangedFiles)(
      priorPair.revision,
      options.currentRevision,
    );
    const effectiveChanges = findEffectiveChanges(changedFiles, effectiveDirectories);
    if (effectiveChanges.length) {
      return {
        ...baseResult,
        mode: 'build',
        reason: 'effective-inputs-changed',
        detail: 'Runner image inputs changed since the newest complete candidate pair.',
        priorPair,
        candidateAgeDays: pairAgeDays(priorPair, now),
        effectiveChanges,
      };
    }

    const candidateAgeDays = pairAgeDays(priorPair, now);
    if (candidateAgeDays >= FRESHNESS_DAYS) {
      return {
        ...baseResult,
        mode: 'build',
        reason: 'freshness-threshold',
        detail: `The newest complete candidate pair is at least ${FRESHNESS_DAYS} days old.`,
        priorPair,
        candidateAgeDays,
      };
    }

    return {
      ...baseResult,
      mode: 'skip-recent',
      reason: 'recent-unchanged-pair',
      detail: 'The newest complete pair is recent and no effective runner image input changed.',
      priorPair,
      candidateAgeDays,
    };
  } catch (error) {
    return {
      ...baseResult,
      mode: 'build',
      reason: 'planner-failed-open',
      detail: `The planner could not complete its required reads: ${errorMessage(error)}`,
      priorPair: null,
      candidateAgeDays: null,
    };
  }
}

export function inspectCandidateInventory(
  images: Image[],
  currentRevision: string,
): InventorySelection {
  const groups = new Map<
    string,
    Map<PlannedCandidateImage['architecture'], PlannedCandidateImage>
  >();

  for (const image of images) {
    const candidate = parseCandidateImage(image);
    const group = groups.get(candidate.revision) ?? new Map();
    const existing = group.get(candidate.architecture);
    if (existing) {
      throw new Error(
        `Candidate revision ${candidate.revision} has multiple ${candidate.architecture} AMIs: ${existing.amiId}, ${candidate.amiId}.`,
      );
    }
    group.set(candidate.architecture, candidate);
    groups.set(candidate.revision, group);
  }

  const orderedGroups = [...groups.entries()]
    .map(([revision, group]) => ({
      revision,
      group,
      newestCreatedAt: Math.max(...[...group.values()].map((image) => Date.parse(image.createdAt))),
    }))
    .sort((left, right) => right.newestCreatedAt - left.newestCreatedAt);
  const pairs = orderedGroups
    .filter(({group}) => ARCHITECTURES.every((architecture) => group.has(architecture)))
    .map(({revision, group}) => ({
      revision,
      images: ARCHITECTURES.map((architecture) => requiredMapValue(group, architecture)),
    }));
  const currentPair = pairs.find((pair) => pair.revision === currentRevision) ?? null;
  const newestPriorPair = pairs.find((pair) => pair.revision !== currentRevision) ?? null;
  const newestGroup = orderedGroups[0];

  return {
    currentPair,
    newestPriorPair,
    newestGroupIsPartial: Boolean(
      newestGroup && !ARCHITECTURES.every((architecture) => newestGroup.group.has(architecture)),
    ),
  };
}

export function resolveProductionWorkspaceClosure(
  manifests: WorkspaceManifest[],
  entryPackage = '@shipfox/runner',
): string[] {
  const manifestsByName = new Map<string, WorkspaceManifest>();
  for (const manifest of manifests) {
    if (manifestsByName.has(manifest.name)) {
      throw new Error(`Workspace package ${manifest.name} is declared more than once.`);
    }
    manifestsByName.set(manifest.name, manifest);
  }

  if (!manifestsByName.has(entryPackage)) {
    throw new Error(`Workspace package ${entryPackage} was not found.`);
  }

  const visited = new Set<string>();
  const pending = [entryPackage];
  while (pending.length) {
    const packageName = pending.pop();
    if (!packageName || visited.has(packageName)) continue;
    visited.add(packageName);
    const manifest = requiredMapValue(manifestsByName, packageName);
    appendProductionWorkspaceDependencies(manifest, manifestsByName, pending);
  }

  return [...visited]
    .map((packageName) => dirname(requiredMapValue(manifestsByName, packageName).path))
    .sort();
}

export function findEffectiveChanges(
  changedFiles: string[],
  productionPackageDirectories: string[],
): string[] {
  const exactInputs = new Set<string>(ROOT_EFFECTIVE_INPUTS);
  const directories = [
    'infra/images/runner',
    ...BUILD_TOOL_DIRECTORIES,
    ...productionPackageDirectories,
  ];
  return changedFiles.filter(
    (path) => exactInputs.has(path) || directories.some((directory) => isWithin(path, directory)),
  );
}

function decideFromInventory(
  options: CandidatePlannerOptions,
  inventory: InventorySelection,
  now: Date,
): CandidatePlannerResult | null {
  if (inventory.currentPair) {
    return {
      mode: 'reuse-current',
      reason: 'current-pair-exists',
      detail: 'The current revision already owns a complete candidate pair.',
      currentRevision: options.currentRevision,
      priorPair: inventory.currentPair,
      candidateAgeDays: pairAgeDays(inventory.currentPair, now),
      effectiveChanges: [],
    };
  }
  if (options.force) {
    return inventoryBuildResult(
      options.currentRevision,
      'manual-publication',
      'Manual publication bypasses the freshness and effective-change gates.',
      inventory.newestPriorPair,
      now,
    );
  }
  if (inventory.newestGroupIsPartial) {
    return inventoryBuildResult(
      options.currentRevision,
      'partial-candidate-pair',
      'The newest candidate revision does not have both architectures.',
      inventory.newestPriorPair,
      now,
    );
  }
  if (!inventory.newestPriorPair) {
    return inventoryBuildResult(
      options.currentRevision,
      'no-complete-pair',
      'No complete prior candidate pair is available.',
      null,
      now,
    );
  }
  return null;
}

function inventoryBuildResult(
  currentRevision: string,
  reason: string,
  detail: string,
  priorPair: PlannedCandidatePair | null,
  now: Date,
): CandidatePlannerResult {
  return {
    mode: 'build',
    reason,
    detail,
    currentRevision,
    priorPair,
    candidateAgeDays: priorPair ? pairAgeDays(priorPair, now) : null,
    effectiveChanges: [],
  };
}

function requiredPriorPair(inventory: InventorySelection): PlannedCandidatePair {
  if (!inventory.newestPriorPair) {
    throw new Error('Candidate inventory decision did not select a prior pair.');
  }
  return inventory.newestPriorPair;
}

function appendProductionWorkspaceDependencies(
  manifest: WorkspaceManifest,
  manifestsByName: Map<string, WorkspaceManifest>,
  pending: string[],
): void {
  const productionDependencies = {
    ...manifest.peerDependencies,
    ...manifest.optionalDependencies,
    ...manifest.dependencies,
  };
  for (const [dependencyName, version] of Object.entries(productionDependencies)) {
    if (manifestsByName.has(dependencyName)) {
      pending.push(dependencyName);
    } else if (version.startsWith('workspace:')) {
      throw new Error(
        `Workspace dependency ${dependencyName} from ${manifest.name} has no package manifest.`,
      );
    }
  }
}

async function listCandidateImages(
  client: CandidateInventoryClient = new EC2Client({region: CANDIDATE_REGION}),
): Promise<Image[]> {
  const images: Image[] = [];
  const seenTokens = new Set<string>();
  let nextToken: string | undefined;
  do {
    const output = await client.send(
      new DescribeImagesCommand({
        Owners: ['self'],
        Filters: [
          {Name: 'state', Values: ['available']},
          {Name: 'tag:shipfox.managed', Values: ['true']},
          {Name: 'tag:shipfox.lifecycle', Values: ['candidate']},
        ],
        MaxResults: 1000,
        NextToken: nextToken,
      }),
    );
    images.push(...(output.Images ?? []));
    nextToken = output.NextToken;
    if (nextToken && seenTokens.has(nextToken)) {
      throw new Error('AWS candidate inventory pagination repeated a token.');
    }
    if (nextToken) seenTokens.add(nextToken);
  } while (nextToken);
  return images;
}

function parseCandidateImage(image: Image): PlannedCandidateImage & {revision: string} {
  const amiId = image.ImageId;
  if (!amiId || !AMI_ID_PATTERN.test(amiId)) {
    throw new Error('Candidate inventory contains an invalid AMI ID.');
  }
  if (image.State !== 'available') {
    throw new Error(`Candidate AMI ${amiId} is not available.`);
  }
  const tags = new Map((image.Tags ?? []).map((tag) => [tag.Key, tag.Value]));
  const revision = tags.get('shipfox.revision');
  requireRevision(revision, `Candidate AMI ${amiId} revision`);
  const architecture = tags.get('shipfox.architecture');
  if (architecture !== 'amd64' && architecture !== 'arm64') {
    throw new Error(`Candidate AMI ${amiId} has an invalid architecture tag.`);
  }
  const expectedAwsArchitecture = architecture === 'amd64' ? 'x86_64' : 'arm64';
  if (image.Architecture !== expectedAwsArchitecture) {
    throw new Error(`Candidate AMI ${amiId} architecture does not match its tag.`);
  }
  if (tags.get('shipfox.candidate_id') !== `main-${revision}`) {
    throw new Error(`Candidate AMI ${amiId} has an invalid candidate identity.`);
  }
  const createdAt = timestamp(image.CreationDate, `Candidate AMI ${amiId} creation time`);
  return {amiId, architecture, createdAt, revision};
}

function resolveRunnerEffectiveDirectories(): string[] {
  const repositoryRoot = repositoryRootPath();
  const output = execFileSync(
    'git',
    ['ls-files', '-z', '--', 'package.json', ':(glob)**/package.json'],
    {cwd: repositoryRoot, encoding: 'utf8'},
  );
  const manifests = output
    .split('\0')
    .filter(Boolean)
    .map((path) => readWorkspaceManifest(repositoryRoot, path));
  return resolveProductionWorkspaceClosure(manifests);
}

function readWorkspaceManifest(repositoryRoot: string, path: string): WorkspaceManifest {
  const value = JSON.parse(readFileSync(resolve(repositoryRoot, path), 'utf8')) as Record<
    string,
    unknown
  >;
  if (typeof value.name !== 'string' || !value.name) {
    throw new Error(`Workspace manifest ${path} has no package name.`);
  }
  const dependencies = dependencyRecord(value.dependencies, path, 'dependencies');
  const optionalDependencies = dependencyRecord(
    value.optionalDependencies,
    path,
    'optionalDependencies',
  );
  const peerDependencies = dependencyRecord(value.peerDependencies, path, 'peerDependencies');
  const devDependencies = dependencyRecord(value.devDependencies, path, 'devDependencies');
  return {
    path,
    name: value.name,
    ...(dependencies ? {dependencies} : {}),
    ...(optionalDependencies ? {optionalDependencies} : {}),
    ...(peerDependencies ? {peerDependencies} : {}),
    ...(devDependencies ? {devDependencies} : {}),
  };
}

function dependencyRecord(
  value: unknown,
  path: string,
  field: string,
): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Workspace manifest ${path} has invalid ${field}.`);
  }
  for (const [name, version] of Object.entries(value)) {
    if (typeof version !== 'string') {
      throw new Error(`Workspace manifest ${path} has an invalid ${field}.${name} value.`);
    }
  }
  return value as Record<string, string>;
}

function gitIsAncestor(base: string, head: string): boolean {
  ensureGitRevision(base);
  ensureGitRevision(head);
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', base, head], {
      cwd: repositoryRootPath(),
      stdio: 'ignore',
    });
    return true;
  } catch (error) {
    if (processStatus(error) === 1) return false;
    throw error;
  }
}

function gitChangedFiles(base: string, head: string): string[] {
  const output = execFileSync('git', ['diff', '--name-only', '--no-renames', base, head], {
    cwd: repositoryRootPath(),
    encoding: 'utf8',
  });
  return output.split('\n').filter(Boolean);
}

function ensureGitRevision(revision: string): void {
  execFileSync('git', ['cat-file', '-e', `${revision}^{commit}`], {
    cwd: repositoryRootPath(),
    stdio: 'ignore',
  });
}

function repositoryRootPath(): string {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], {encoding: 'utf8'}).trim();
}

function pairAgeDays(pair: PlannedCandidatePair, now: Date): number {
  const newestImageTime = Math.max(...pair.images.map((image) => Date.parse(image.createdAt)));
  const age = (now.getTime() - newestImageTime) / MILLISECONDS_PER_DAY;
  if (!Number.isFinite(age) || age < 0) {
    throw new Error(`Candidate pair ${pair.revision} has an invalid creation time.`);
  }
  return age;
}

function isWithin(path: string, directory: string): boolean {
  return path === directory || path.startsWith(`${directory}/`);
}

function requireRevision(value: string | undefined, label: string): asserts value is string {
  if (!value || !GIT_REVISION_PATTERN.test(value)) {
    throw new Error(`${label} must be a full lowercase Git revision.`);
  }
}

function timestamp(value: string | undefined, label: string): string {
  if (!value) throw new Error(`${label} is missing.`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} is invalid.`);
  return date.toISOString();
}

function requiredMapValue<Key, Value>(map: Map<Key, Value>, key: Key): Value {
  const value = map.get(key);
  if (value === undefined) throw new Error(`Required map value ${String(key)} is missing.`);
  return value;
}

function processStatus(error: unknown): number | undefined {
  return error && typeof error === 'object' && 'status' in error
    ? (error as {status?: number}).status
    : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function parseRunnerImageCandidatePlannerArgs(args: string[]): {
  currentRevision: string;
  force: boolean;
  outputPath: string;
} {
  const {values, positionals} = parseArgs({
    args,
    strict: true,
    options: {
      force: {type: 'boolean', default: false},
      output: {type: 'string'},
      revision: {type: 'string'},
    },
  });
  if (positionals.length) throw new Error('plan-runner-image-candidate does not accept arguments.');
  requireRevision(values.revision, '--revision');
  if (!values.output) throw new Error('--output is required.');
  return {currentRevision: values.revision, force: values.force, outputPath: values.output};
}

export function runRunnerImageCandidatePlannerCli(args = process.argv.slice(2)): void {
  void runRunnerImageCandidatePlannerCliAsync(args).catch((error: unknown) => {
    log.error(String(error));
    process.exitCode = 1;
  });
}

async function runRunnerImageCandidatePlannerCliAsync(args: string[]): Promise<void> {
  const {currentRevision, force, outputPath} = parseRunnerImageCandidatePlannerArgs(args);
  const result = await planRunnerImageCandidate({currentRevision, force});
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  log.info(`Runner image candidate plan: ${result.mode} (${result.reason})`);
}
