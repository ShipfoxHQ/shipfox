import {
  parseRunnerBaseSelection,
  RunnerBaseSelectionError,
  revalidateRunnerBaseImage,
  runnerBaseSelectionWarning,
  selectRunnerBase,
} from '#selection.js';
import {
  addPublishedGeneration,
  FakeAws,
  KEY_ALIAS,
  KEY_ARN,
  NEW_RECIPE,
  NOW,
  OLD_AMI,
  OTHER_KEY_ARN,
  OWNER,
  publishedMetadata,
  RECIPE,
} from './fixtures/aws.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const PUBLISHED_GENERATION = publishedMetadata().generation;
const RECOVERED_GENERATION = '16000000000-1';
const RECOVERED_AMI = {amd64: 'ami-55555555555555555', arm64: 'ami-66666666666666666'};

function addTaggedGeneration(
  aws: FakeAws,
  overrides: {
    createdAt?: string;
    recipeDigest?: string;
    kmsKeyArn?: string;
    status?: 'building' | 'verified';
    architectures?: Array<'amd64' | 'arm64'>;
  } = {},
) {
  for (const architecture of overrides.architectures ?? (['amd64', 'arm64'] as const)) {
    aws.addBase({
      architecture,
      amiId: RECOVERED_AMI[architecture],
      snapshotId: RECOVERED_AMI[architecture].replace('ami-', 'snap-'),
      createdAt: overrides.createdAt ?? '2026-09-24T08:00:00.000Z',
      generation: RECOVERED_GENERATION,
      recipeDigest: overrides.recipeDigest ?? RECIPE,
      status: overrides.status ?? 'verified',
      ...(overrides.kmsKeyArn ? {kmsKeyArn: overrides.kmsKeyArn} : {}),
    });
  }
}

describe('selectRunnerBase', () => {
  let aws: FakeAws;

  beforeEach(() => {
    aws = new FakeAws();
  });

  function select(options: {generation?: string; recipeDigest?: string; now?: Date} = {}) {
    return selectRunnerBase({
      clients: aws.clients(),
      kmsKeyId: KEY_ALIAS,
      recipeDigest: options.recipeDigest ?? RECIPE,
      now: options.now ?? NOW,
      ...(options.generation ? {generation: options.generation} : {}),
    });
  }

  async function selectionError(promise: Promise<unknown>): Promise<RunnerBaseSelectionError> {
    const error = await promise.then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(RunnerBaseSelectionError);
    return error as RunnerBaseSelectionError;
  }

  it('selects both AMIs of the published generation under the resolved key', async () => {
    addPublishedGeneration(aws);

    const selection = await select();

    expect(selection).toEqual({
      generation: PUBLISHED_GENERATION,
      recipeDigest: RECIPE,
      kmsKeyArn: KEY_ARN,
      owner: OWNER,
      createdAt: '2026-09-25T10:00:00.000Z',
      selectedAt: NOW.toISOString(),
      images: [
        {architecture: 'amd64', amiId: OLD_AMI.amd64, createdAt: '2026-09-25T10:00:00.000Z'},
        {architecture: 'arm64', amiId: OLD_AMI.arm64, createdAt: '2026-09-25T10:05:00.000Z'},
      ],
    });
  });

  it('rejects a missing pointer', async () => {
    const error = await selectionError(select());

    expect(error.reason).toBe('missing');
  });

  it('rejects a generation built from another recipe', async () => {
    addPublishedGeneration(aws);

    const error = await selectionError(select({recipeDigest: NEW_RECIPE}));

    expect(error.reason).toBe('recipe-changed');
  });

  it('rejects a generation under another key', async () => {
    addPublishedGeneration(aws);
    aws.keyArn = OTHER_KEY_ARN;

    const error = await selectionError(select());

    expect(error.reason).toBe('key-changed');
  });

  it('accepts a seven-day-old pair and rejects an older one', async () => {
    addPublishedGeneration(aws);
    const createdAt = Date.parse('2026-09-25T10:00:00.000Z');

    await expect(select({now: new Date(createdAt + 7 * DAY_MS)})).resolves.toMatchObject({
      generation: PUBLISHED_GENERATION,
    });
    const error = await selectionError(select({now: new Date(createdAt + 7 * DAY_MS + 1)}));
    expect(error.reason).toBe('stale');
  });

  it('rejects a published AMI whose architecture differs from its tag', async () => {
    addPublishedGeneration(aws);
    const image = aws.images.get(OLD_AMI.arm64);
    if (image) image.Architecture = 'x86_64';

    const error = await selectionError(select());

    expect(error.reason).toBe('unavailable');
    expect(error.message).toContain('architecture x86_64');
  });

  it('rejects a published AMI that is no longer available', async () => {
    addPublishedGeneration(aws);
    aws.images.delete(OLD_AMI.amd64);

    const error = await selectionError(select());

    expect(error.reason).toBe('unavailable');
  });

  it('selects a named generation from its tags when the pointer has moved on', async () => {
    addPublishedGeneration(aws);
    addTaggedGeneration(aws);

    const selection = await select({generation: RECOVERED_GENERATION});

    expect(selection.generation).toBe(RECOVERED_GENERATION);
    expect(selection.images.map((image) => image.amiId)).toEqual([
      RECOVERED_AMI.amd64,
      RECOVERED_AMI.arm64,
    ]);
    expect(selection.kmsKeyArn).toBe(KEY_ARN);
  });

  it('rejects a named generation that lost an architecture', async () => {
    addTaggedGeneration(aws, {architectures: ['amd64']});

    const error = await selectionError(select({generation: RECOVERED_GENERATION}));

    expect(error.reason).toBe('unavailable');
  });

  it('rejects a named generation from another recipe', async () => {
    addTaggedGeneration(aws, {recipeDigest: NEW_RECIPE});

    const error = await selectionError(select({generation: RECOVERED_GENERATION}));

    expect(error.reason).toBe('recipe-changed');
  });

  it('rejects a named generation that was never verified', async () => {
    addTaggedGeneration(aws, {status: 'building'});

    const error = await selectionError(select({generation: RECOVERED_GENERATION}));

    expect(error.reason).toBe('unavailable');
  });

  it('rejects a named generation encrypted under another key', async () => {
    addTaggedGeneration(aws, {kmsKeyArn: OTHER_KEY_ARN});

    const error = await selectionError(select({generation: RECOVERED_GENERATION}));

    expect(error.reason).toBe('key-changed');
  });

  it('rejects a named generation older than seven days', async () => {
    addTaggedGeneration(aws, {createdAt: '2026-09-20T11:59:00.000Z'});

    const error = await selectionError(select({generation: RECOVERED_GENERATION}));

    expect(error.reason).toBe('stale');
  });
});

describe('runnerBaseSelectionWarning', () => {
  const selection = parseRunnerBaseSelection({
    generation: PUBLISHED_GENERATION,
    recipeDigest: RECIPE,
    kmsKeyArn: KEY_ARN,
    owner: OWNER,
    createdAt: '2026-09-25T10:00:00.000Z',
    selectedAt: '2026-09-27T10:00:00.000Z',
    images: [
      {architecture: 'amd64', amiId: OLD_AMI.amd64, createdAt: '2026-09-25T10:00:00.000Z'},
      {architecture: 'arm64', amiId: OLD_AMI.arm64, createdAt: '2026-09-25T10:05:00.000Z'},
    ],
  });

  it('stays quiet up to two days', () => {
    expect(runnerBaseSelectionWarning(selection)).toBeNull();
  });

  it('warns about a pair older than two days', () => {
    expect(
      runnerBaseSelectionWarning({...selection, selectedAt: '2026-09-27T10:00:01.000Z'}),
    ).toContain(`${PUBLISHED_GENERATION} is 2.00 days old`);
  });
});

describe('revalidateRunnerBaseImage', () => {
  let aws: FakeAws;

  beforeEach(() => {
    aws = new FakeAws();
    addPublishedGeneration(aws);
  });

  function selected(now = NOW) {
    return selectRunnerBase({
      clients: aws.clients(),
      kmsKeyId: KEY_ALIAS,
      recipeDigest: RECIPE,
      now,
    });
  }

  function revalidate(
    selection: Awaited<ReturnType<typeof selected>>,
    now: Date,
    architecture: 'amd64' | 'arm64' = 'arm64',
  ) {
    return revalidateRunnerBaseImage({
      ec2: aws.clients().ec2,
      selection,
      architecture,
      now,
    });
  }

  it('returns the selected AMI for its architecture within one day of selection', async () => {
    const selection = await selected();

    await expect(revalidate(selection, new Date(NOW.getTime() + DAY_MS))).resolves.toEqual({
      architecture: 'arm64',
      amiId: OLD_AMI.arm64,
      createdAt: '2026-09-25T10:05:00.000Z',
    });
  });

  it('requires a new selection after one day', async () => {
    const selection = await selected();

    await expect(revalidate(selection, new Date(NOW.getTime() + DAY_MS + 1))).rejects.toThrow(
      'Re-run all jobs to select a base again',
    );
  });

  it('rejects a selected AMI that was deregistered before launch', async () => {
    const selection = await selected();
    aws.images.delete(OLD_AMI.arm64);

    await expect(revalidate(selection, NOW)).rejects.toThrow('was not found in this account');
  });

  it('rejects a selected AMI whose generation tag changed', async () => {
    const selection = await selected();
    const image = aws.images.get(OLD_AMI.arm64);
    const generationTag = image?.Tags?.find((tag) => tag.Key === 'shipfox.base_generation');
    if (generationTag) generationTag.Value = 'another-generation';

    await expect(revalidate(selection, NOW)).rejects.toThrow('shipfox.base_generation');
  });

  it('rejects a selection whose pair was older than seven days', async () => {
    const selection = await selected();

    await expect(
      revalidate({...selection, createdAt: '2026-09-20T11:59:59.000Z'}, NOW),
    ).rejects.toThrow('older than 7 days when selected');
  });
});

describe('parseRunnerBaseSelection', () => {
  const value = {
    generation: PUBLISHED_GENERATION,
    recipeDigest: RECIPE,
    kmsKeyArn: KEY_ARN,
    owner: OWNER,
    createdAt: '2026-09-25T10:00:00.000Z',
    selectedAt: NOW.toISOString(),
    images: [
      {architecture: 'arm64', amiId: OLD_AMI.arm64, createdAt: '2026-09-25T10:05:00.000Z'},
      {architecture: 'amd64', amiId: OLD_AMI.amd64, createdAt: '2026-09-25T10:00:00.000Z'},
    ],
  };

  it('reads a selection and orders its images by architecture', () => {
    expect(parseRunnerBaseSelection(value).images.map((image) => image.architecture)).toEqual([
      'amd64',
      'arm64',
    ]);
  });

  it('rejects a selection without both architectures', () => {
    expect(() =>
      parseRunnerBaseSelection({...value, images: [value.images[0], value.images[0]]}),
    ).toThrow('exactly one amd64 and one arm64 AMI');
  });

  it('rejects a key alias in place of a key ARN', () => {
    expect(() => parseRunnerBaseSelection({...value, kmsKeyArn: KEY_ALIAS})).toThrow(
      'kmsKeyArn is invalid',
    );
  });
});
