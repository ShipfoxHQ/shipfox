import {
  CreateTagsCommand,
  DescribeImagesCommand,
  DescribeSnapshotsCommand,
  type Filter,
  type Image,
  type Snapshot,
  type Tag,
} from '@aws-sdk/client-ec2';
import {DescribeKeyCommand} from '@aws-sdk/client-kms';
import {GetParameterCommand, GetParametersCommand, PutParameterCommand} from '@aws-sdk/client-ssm';
import {
  RUNNER_BASE_POINTER_PARAMETER,
  type RunnerBaseArchitecture,
  type RunnerBaseMetadata,
  runnerBaseImageTags,
} from '#metadata.js';
import {
  CANONICAL_OWNER_ID,
  CANONICAL_SOURCE_PARAMETERS,
  type RunnerBaseClients,
} from '#publication.js';

export const OWNER = '123456789012';
export const KEY_ARN = `arn:aws:kms:eu-central-1:${OWNER}:key/1234abcd-12ab-34cd-56ef-1234567890ab`;
export const OTHER_KEY_ARN = `arn:aws:kms:eu-central-1:${OWNER}:key/9999abcd-12ab-34cd-56ef-1234567890ab`;
export const KEY_ALIAS = 'alias/shipfox-runner-image-candidate';
export const RECIPE = `sha256:${'a'.repeat(64)}`;
export const NEW_RECIPE = `sha256:${'b'.repeat(64)}`;
export const REVISION = '0123456789abcdef0123456789abcdef01234567';
export const GENERATION = '18000000000-1';
export const BUILD_URL = 'https://github.com/ShipfoxHQ/shipfox/actions/runs/18000000000/attempts/1';
export const NOW = new Date('2026-09-27T12:00:00.000Z');

export const AMI = {amd64: 'ami-11111111111111111', arm64: 'ami-22222222222222222'};
export const SNAPSHOT = {amd64: 'snap-11111111111111111', arm64: 'snap-22222222222222222'};
export const SOURCE = {amd64: 'ami-aaaaaaaaaaaaaaaaa', arm64: 'ami-bbbbbbbbbbbbbbbbb'};
export const OLD_AMI = {amd64: 'ami-33333333333333333', arm64: 'ami-44444444444444444'};

export class FakeAws {
  images = new Map<string, Image>();
  snapshots = new Map<string, Snapshot>();
  parameters = new Map<string, string>();
  keyState = 'Enabled';
  keyArn = KEY_ARN;
  failNextCreateTags = false;
  puts: string[] = [];
  createTagCalls = 0;

  clients(): RunnerBaseClients {
    return {ec2: this, kms: this, ssm: this} as unknown as RunnerBaseClients;
  }

  // biome-ignore lint/suspicious/noExplicitAny: the fake answers every SDK command it supports.
  send(command: any): Promise<any> {
    return Promise.resolve().then(() => this.handle(command));
  }

  // biome-ignore lint/suspicious/noExplicitAny: see send.
  private handle(command: any): unknown {
    if (command instanceof DescribeKeyCommand) {
      return {KeyMetadata: {Arn: this.keyArn, KeyState: this.keyState}};
    }
    if (command instanceof GetParametersCommand) return this.getParameters(command.input.Names);
    if (command instanceof GetParameterCommand) return this.getParameter(command.input.Name);
    if (command instanceof PutParameterCommand) {
      this.puts.push(command.input.Value as string);
      this.parameters.set(command.input.Name as string, command.input.Value as string);
      return {};
    }
    if (command instanceof DescribeImagesCommand) return this.describeImages(command.input);
    if (command instanceof DescribeSnapshotsCommand) {
      return {Snapshots: found(this.snapshots, command.input.SnapshotIds)};
    }
    if (command instanceof CreateTagsCommand) return this.createTags(command.input);
    throw new Error(`Unexpected command ${command.constructor.name}`);
  }

  private getParameters(names: string[] = []) {
    return {
      Parameters: names
        .filter((name) => this.parameters.has(name))
        .map((name) => ({Name: name, Value: this.parameters.get(name)})),
      InvalidParameters: names.filter((name) => !this.parameters.has(name)),
    };
  }

  private getParameter(name = '') {
    const value = this.parameters.get(name);
    if (value === undefined) throw Object.assign(new Error('missing'), {name: 'ParameterNotFound'});
    return {Parameter: {Name: name, Value: value}};
  }

  private describeImages(input: DescribeImagesCommand['input']) {
    const selfOnly = input.Owners?.includes('self');
    const images = input.ImageIds
      ? found(this.images, input.ImageIds)
      : [...this.images.values()].map((image) => structuredClone(image));
    return {
      Images: images.filter(
        (image) =>
          (!selfOnly || image.OwnerId === OWNER) &&
          (input.Filters ?? []).every((filter) => matchesFilter(image, filter)),
      ),
    };
  }

  private createTags(input: CreateTagsCommand['input']) {
    this.createTagCalls++;
    const resources = input.Resources ?? [];
    // A failing call tags only its first resource: a partial tagging failure.
    const failing = this.failNextCreateTags;
    this.failNextCreateTags = false;
    for (const resource of failing ? resources.slice(0, 1) : resources) {
      const target = this.images.get(resource) ?? this.snapshots.get(resource);
      if (target) target.Tags = mergeTags(target.Tags, input.Tags ?? []);
    }
    if (failing) throw new Error('CreateTags throttled');
    return {};
  }

  addCanonicalSources(overrides: Partial<Record<RunnerBaseArchitecture, Partial<Image>>> = {}) {
    for (const architecture of ['amd64', 'arm64'] as const) {
      this.parameters.set(CANONICAL_SOURCE_PARAMETERS[architecture], SOURCE[architecture]);
      this.images.set(SOURCE[architecture], {
        ImageId: SOURCE[architecture],
        OwnerId: CANONICAL_OWNER_ID,
        Architecture: architecture === 'amd64' ? 'x86_64' : 'arm64',
        Name: `ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-${architecture}-server-20260920`,
        State: 'available',
        RootDeviceType: 'ebs',
        CreationDate: '2026-09-20T00:00:00.000Z',
        ...overrides[architecture],
      });
    }
  }

  addBase(options: {
    architecture: RunnerBaseArchitecture;
    amiId: string;
    snapshotId: string;
    createdAt: string;
    generation?: string;
    recipeDigest?: string;
    status?: 'building' | 'verified';
    kmsKeyArn?: string;
  }) {
    const tags = tagList(
      runnerBaseImageTags({
        architecture: options.architecture,
        generation: options.generation ?? GENERATION,
        recipeDigest: options.recipeDigest ?? RECIPE,
        revision: REVISION,
        status: options.status ?? 'building',
      }),
    );
    this.images.set(options.amiId, {
      ImageId: options.amiId,
      Architecture: options.architecture === 'amd64' ? 'x86_64' : 'arm64',
      OwnerId: OWNER,
      State: 'available',
      CreationDate: options.createdAt,
      BlockDeviceMappings: [{DeviceName: '/dev/sda1', Ebs: {SnapshotId: options.snapshotId}}],
      Tags: tags,
    });
    this.snapshots.set(options.snapshotId, {
      SnapshotId: options.snapshotId,
      OwnerId: OWNER,
      Encrypted: true,
      KmsKeyId: options.kmsKeyArn ?? KEY_ARN,
      Tags: structuredClone(tags),
    });
  }

  addBuiltPair(createdAt = {amd64: '2026-09-27T10:10:00.000Z', arm64: '2026-09-27T10:05:00.000Z'}) {
    for (const architecture of ['amd64', 'arm64'] as const) {
      this.addBase({
        architecture,
        amiId: AMI[architecture],
        snapshotId: SNAPSHOT[architecture],
        createdAt: createdAt[architecture],
      });
    }
  }

  publishPointer(metadata: RunnerBaseMetadata) {
    this.parameters.set(RUNNER_BASE_POINTER_PARAMETER, JSON.stringify(metadata));
  }

  pointer(): RunnerBaseMetadata | null {
    const value = this.parameters.get(RUNNER_BASE_POINTER_PARAMETER);
    return value ? JSON.parse(value) : null;
  }

  tagsOf(resource: string): Record<string, string> {
    const tags = (this.images.get(resource) ?? this.snapshots.get(resource))?.Tags ?? [];
    return Object.fromEntries(tags.map((tag) => [tag.Key, tag.Value]));
  }
}

function found<T>(items: Map<string, T>, ids: string[] = []): T[] {
  return ids.flatMap((id) => {
    const item = items.get(id);
    return item ? [structuredClone(item)] : [];
  });
}

function matchesFilter(image: Image, filter: Filter): boolean {
  const name = filter.Name ?? '';
  let value: string | undefined;
  if (name === 'state') value = image.State;
  else if (name.startsWith('tag:')) {
    value = image.Tags?.find((tag) => tag.Key === name.slice('tag:'.length))?.Value;
  }
  return value !== undefined && (filter.Values ?? []).includes(value);
}

export function tagList(tags: Record<string, string>): Tag[] {
  return Object.entries(tags).map(([Key, Value]) => ({Key, Value}));
}

function mergeTags(existing: Tag[] | undefined, updates: Tag[]): Tag[] {
  const merged = new Map((existing ?? []).map((tag) => [tag.Key, tag.Value]));
  for (const tag of updates) merged.set(tag.Key, tag.Value);
  return [...merged].map(([Key, Value]) => ({Key, Value}));
}

export function publishedMetadata(overrides: Partial<RunnerBaseMetadata> = {}): RunnerBaseMetadata {
  return {
    apiVersion: 'shipfox.runner-base/v1',
    generation: '17000000000-1',
    recipeDigest: RECIPE,
    sourceRevision: REVISION,
    buildUrl: 'https://github.com/ShipfoxHQ/shipfox/actions/runs/17000000000/attempts/1',
    createdAt: '2026-09-25T10:00:00.000Z',
    verifiedAt: '2026-09-25T10:30:00.000Z',
    owner: OWNER,
    region: 'eu-central-1',
    kmsKeyArn: KEY_ARN,
    imageOs: 'ubuntu24',
    images: [
      {
        architecture: 'amd64',
        amiId: OLD_AMI.amd64,
        sourceAmiId: SOURCE.amd64,
        createdAt: '2026-09-25T10:00:00.000Z',
      },
      {
        architecture: 'arm64',
        amiId: OLD_AMI.arm64,
        sourceAmiId: SOURCE.arm64,
        createdAt: '2026-09-25T10:05:00.000Z',
      },
    ],
    ...overrides,
  };
}

export function addPublishedGeneration(aws: FakeAws, metadata = publishedMetadata()) {
  for (const image of metadata.images) {
    aws.addBase({
      architecture: image.architecture,
      amiId: image.amiId,
      snapshotId: image.amiId.replace('ami-', 'snap-'),
      createdAt: image.createdAt,
      generation: metadata.generation,
      recipeDigest: metadata.recipeDigest,
      status: 'verified',
    });
  }
  aws.publishPointer(metadata);
}
