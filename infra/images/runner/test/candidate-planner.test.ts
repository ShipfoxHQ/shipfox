import type {Image} from '@aws-sdk/client-ec2';
import {type RunnerBaseSelection, RunnerBaseSelectionError} from '@shipfox/runner-base';
import {
  findEffectiveChanges,
  inspectCandidateInventory,
  parseRunnerImageCandidatePlannerArgs,
  planRunnerImageCandidate,
  resolveProductionWorkspaceClosure,
  type WorkspaceManifest,
} from '#candidate-planner.js';

const CURRENT_REVISION = '2222222222222222222222222222222222222222';
const PRIOR_REVISION = '1111111111111111111111111111111111111111';
const UNPUBLISHED_REVISION = '3333333333333333333333333333333333333333';
const NOW = new Date('2026-09-20T12:00:00.000Z');
const BASE_GENERATION = '18000000000-1';
const NEW_BASE_GENERATION = '18100000000-1';

function candidate(
  architecture: 'amd64' | 'arm64',
  revision = PRIOR_REVISION,
  createdAt = '2026-09-18T12:00:00.000Z',
  amiSuffix = architecture === 'amd64' ? '1' : '2',
  baseGeneration: string | null = BASE_GENERATION,
): Image {
  return {
    Architecture: architecture === 'amd64' ? 'x86_64' : 'arm64',
    CreationDate: createdAt,
    ImageId: `ami-${amiSuffix.repeat(17)}`,
    State: 'available',
    Tags: [
      {Key: 'shipfox.managed', Value: 'true'},
      {Key: 'shipfox.lifecycle', Value: 'candidate'},
      {Key: 'shipfox.candidate_id', Value: `main-${revision}`},
      {Key: 'shipfox.revision', Value: revision},
      {Key: 'shipfox.architecture', Value: architecture},
      ...(baseGeneration ? [{Key: 'shipfox.base_generation', Value: baseGeneration}] : []),
    ],
  };
}

function baseSelection(generation = BASE_GENERATION): RunnerBaseSelection {
  return {
    generation,
    recipeDigest: `sha256:${'a'.repeat(64)}`,
    kmsKeyArn: 'arn:aws:kms:eu-central-1:123456789012:key/1234abcd-12ab-34cd-56ef-1234567890ab',
    owner: '123456789012',
    createdAt: '2026-09-19T12:00:00.000Z',
    selectedAt: NOW.toISOString(),
    images: [
      {
        architecture: 'amd64',
        amiId: 'ami-aaaaaaaaaaaaaaaaa',
        createdAt: '2026-09-19T12:00:00.000Z',
      },
      {
        architecture: 'arm64',
        amiId: 'ami-bbbbbbbbbbbbbbbbb',
        createdAt: '2026-09-19T12:05:00.000Z',
      },
    ],
  };
}

function plannerDependencies(
  images: Image[],
  overrides: {
    changedFiles?: string[];
    isAncestor?: boolean;
    publishedRevisions?: string[];
    resolveEffectiveDirectories?: () => string[];
    selectBase?: (generation?: string) => Promise<RunnerBaseSelection>;
  } = {},
) {
  return {
    listImages: async () => images,
    selectBase:
      overrides.selectBase ?? ((generation?: string) => Promise.resolve(baseSelection(generation))),
    listPublishedRevisions: () => overrides.publishedRevisions ?? [PRIOR_REVISION],
    resolveEffectiveDirectories:
      overrides.resolveEffectiveDirectories ?? (() => ['apps/runner', 'libs/runner/agent']),
    isAncestor: () => overrides.isAncestor ?? true,
    listChangedFiles: () => overrides.changedFiles ?? [],
  };
}

describe('runner image candidate planner', () => {
  it('reuses a complete pair for the current revision', async () => {
    const images = [candidate('amd64', CURRENT_REVISION), candidate('arm64', CURRENT_REVISION)];

    const result = await planRunnerImageCandidate(
      {currentRevision: CURRENT_REVISION, force: false, now: NOW},
      plannerDependencies(images),
    );

    expect(result.mode).toBe('reuse-current');
    expect(result.reason).toBe('current-pair-exists');
    expect(result.priorPair?.revision).toBe(CURRENT_REVISION);
    expect(result.base).toBeNull();
  });

  it('keeps an exact-revision pair without selecting a base', async () => {
    const images = [
      candidate('amd64', CURRENT_REVISION, undefined, undefined, null),
      candidate('arm64', CURRENT_REVISION, undefined, undefined, null),
    ];
    const selectBase = vi.fn();

    const result = await planRunnerImageCandidate(
      {currentRevision: CURRENT_REVISION, force: false, now: NOW},
      {...plannerDependencies(images), selectBase},
    );

    expect(result.mode).toBe('reuse-current');
    expect(selectBase).not.toHaveBeenCalled();
  });

  it('reuses the current pair without listing published revisions', async () => {
    const images = [candidate('amd64', CURRENT_REVISION), candidate('arm64', CURRENT_REVISION)];

    const result = await planRunnerImageCandidate(
      {currentRevision: CURRENT_REVISION, force: false, now: NOW},
      {
        ...plannerDependencies([...images, candidate('amd64'), candidate('arm64')]),
        listPublishedRevisions: () => {
          throw new Error('registry unavailable');
        },
      },
    );

    expect(result.mode).toBe('reuse-current');
    expect(result.priorPair?.revision).toBe(CURRENT_REVISION);
  });

  it('builds when no complete prior pair exists', async () => {
    const result = await planRunnerImageCandidate(
      {currentRevision: CURRENT_REVISION, force: false, now: NOW},
      plannerDependencies([]),
    );

    expect(result.mode).toBe('build');
    expect(result.reason).toBe('no-complete-pair');
  });

  it('builds when effective inputs changed since the prior pair', async () => {
    const result = await planRunnerImageCandidate(
      {currentRevision: CURRENT_REVISION, force: false, now: NOW},
      plannerDependencies([candidate('amd64'), candidate('arm64')], {
        changedFiles: ['libs/runner/agent/src/index.ts'],
      }),
    );

    expect(result.mode).toBe('build');
    expect(result.reason).toBe('effective-inputs-changed');
    expect(result.effectiveChanges).toEqual(['libs/runner/agent/src/index.ts']);
  });

  it('ignores a newer pair whose manifest was never published', async () => {
    const images = [
      candidate('amd64'),
      candidate('arm64'),
      candidate('amd64', UNPUBLISHED_REVISION, '2026-09-19T12:00:00.000Z', '3'),
      candidate('arm64', UNPUBLISHED_REVISION, '2026-09-19T12:00:00.000Z', '4'),
    ];

    const result = await planRunnerImageCandidate(
      {currentRevision: CURRENT_REVISION, force: false, now: NOW},
      {
        ...plannerDependencies(images),
        listChangedFiles: (base: string) =>
          base === UNPUBLISHED_REVISION ? [] : ['libs/runner/agent/src/index.ts'],
      },
    );

    expect(result.mode).toBe('build');
    expect(result.reason).toBe('effective-inputs-changed');
    expect(result.priorPair?.revision).toBe(PRIOR_REVISION);
  });

  it('builds when no complete pair has a published manifest', async () => {
    const result = await planRunnerImageCandidate(
      {currentRevision: CURRENT_REVISION, force: false, now: NOW},
      plannerDependencies([candidate('amd64'), candidate('arm64')], {publishedRevisions: []}),
    );

    expect(result.mode).toBe('build');
    expect(result.reason).toBe('no-complete-pair');
  });

  it('builds when published candidate revisions cannot be listed', async () => {
    const result = await planRunnerImageCandidate(
      {currentRevision: CURRENT_REVISION, force: false, now: NOW},
      {
        ...plannerDependencies([candidate('amd64'), candidate('arm64')]),
        listPublishedRevisions: () => {
          throw new Error('registry unavailable');
        },
      },
    );

    expect(result.mode).toBe('build');
    expect(result.reason).toBe('planner-failed-open');
  });

  it('builds when the prior pair reaches five days old', async () => {
    const images = [
      candidate('amd64', PRIOR_REVISION, '2026-09-15T12:00:00.000Z'),
      candidate('arm64', PRIOR_REVISION, '2026-09-15T12:00:00.000Z'),
    ];

    const result = await planRunnerImageCandidate(
      {currentRevision: CURRENT_REVISION, force: false, now: NOW},
      plannerDependencies(images),
    );

    expect(result.mode).toBe('build');
    expect(result.reason).toBe('freshness-threshold');
    expect(result.candidateAgeDays).toBe(5);
  });

  it('skips a recent pair when effective inputs did not change', async () => {
    const result = await planRunnerImageCandidate(
      {currentRevision: CURRENT_REVISION, force: false, now: NOW},
      plannerDependencies([candidate('amd64'), candidate('arm64')], {
        changedFiles: ['apps/client/src/index.ts'],
      }),
    );

    expect(result.mode).toBe('skip-recent');
    expect(result.reason).toBe('recent-unchanged-pair');
    expect(result.priorPair?.revision).toBe(PRIOR_REVISION);
  });

  it('builds when the newest inventory group is partial', async () => {
    const images = [
      candidate('amd64'),
      candidate('arm64'),
      candidate('amd64', UNPUBLISHED_REVISION, '2026-09-19T12:00:00.000Z', '3'),
    ];

    const result = await planRunnerImageCandidate(
      {currentRevision: CURRENT_REVISION, force: false, now: NOW},
      plannerDependencies(images),
    );

    expect(result.mode).toBe('build');
    expect(result.reason).toBe('partial-candidate-pair');
  });

  it('completes a partial current pair from its surviving base generation', async () => {
    const selectBase = vi.fn((generation?: string) => Promise.resolve(baseSelection(generation)));
    const images = [
      candidate('amd64'),
      candidate('arm64'),
      candidate('amd64', CURRENT_REVISION, '2026-09-19T12:00:00.000Z', '3', NEW_BASE_GENERATION),
    ];

    const result = await planRunnerImageCandidate(
      {currentRevision: CURRENT_REVISION, force: false, now: NOW},
      plannerDependencies(images, {selectBase}),
    );

    expect(result.mode).toBe('build');
    expect(result.reason).toBe('partial-current-pair');
    expect(selectBase).toHaveBeenCalledWith(NEW_BASE_GENERATION);
    expect(result.base).toMatchObject({
      action: 'select',
      reason: 'recover-partial-pair',
      selection: {generation: NEW_BASE_GENERATION},
    });
  });

  it('fails open without recovery when the surviving current image predates base images', async () => {
    const images = [
      candidate('amd64'),
      candidate('arm64'),
      candidate('amd64', CURRENT_REVISION, '2026-09-19T12:00:00.000Z', '3', null),
    ];

    const result = await planRunnerImageCandidate(
      {currentRevision: CURRENT_REVISION, force: false, now: NOW},
      plannerDependencies(images),
    );

    expect(result.reason).toBe('planner-failed-open');
    expect(result.detail).toContain('predates runner base images');
    expect(result.base).toMatchObject({action: 'refresh', selection: null});
  });

  it('builds a new revision when the selected base generation changed', async () => {
    const result = await planRunnerImageCandidate(
      {currentRevision: CURRENT_REVISION, force: false, now: NOW},
      plannerDependencies([candidate('amd64'), candidate('arm64')], {
        selectBase: () => Promise.resolve(baseSelection(NEW_BASE_GENERATION)),
      }),
    );

    expect(result.mode).toBe('build');
    expect(result.reason).toBe('base-generation-changed');
    expect(result.base?.selection?.generation).toBe(NEW_BASE_GENERATION);
  });

  it('builds a new revision when the prior pair has no base tags', async () => {
    const images = [
      candidate('amd64', PRIOR_REVISION, undefined, undefined, null),
      candidate('arm64', PRIOR_REVISION, undefined, undefined, null),
    ];

    const result = await planRunnerImageCandidate(
      {currentRevision: CURRENT_REVISION, force: false, now: NOW},
      plannerDependencies(images),
    );

    expect(result.mode).toBe('build');
    expect(result.reason).toBe('base-generation-changed');
    expect(result.detail).toContain('base generation <none>');
  });

  it('asks for a base refresh when no acceptable base is published', async () => {
    const result = await planRunnerImageCandidate(
      {currentRevision: CURRENT_REVISION, force: false, now: NOW},
      plannerDependencies([candidate('amd64'), candidate('arm64')], {
        selectBase: () =>
          Promise.reject(new RunnerBaseSelectionError('stale', 'The older image is 8 days old.')),
      }),
    );

    expect(result.mode).toBe('build');
    expect(result.reason).toBe('base-refresh-required');
    expect(result.base).toEqual({
      action: 'refresh',
      reason: 'stale',
      detail: 'The older image is 8 days old.',
      selection: null,
    });
  });

  it('asks for a base refresh alongside an inventory build decision', async () => {
    const result = await planRunnerImageCandidate(
      {currentRevision: CURRENT_REVISION, force: false, now: NOW},
      plannerDependencies([], {
        selectBase: () => Promise.reject(new RunnerBaseSelectionError('missing', 'Not set.')),
      }),
    );

    expect(result.reason).toBe('no-complete-pair');
    expect(result.base).toMatchObject({action: 'refresh', reason: 'missing'});
  });

  it('builds when the prior revision is not an ancestor', async () => {
    const result = await planRunnerImageCandidate(
      {currentRevision: CURRENT_REVISION, force: false, now: NOW},
      plannerDependencies([candidate('amd64'), candidate('arm64')], {isAncestor: false}),
    );

    expect(result.mode).toBe('build');
    expect(result.reason).toBe('prior-not-ancestor');
  });

  it('builds when a required inventory read fails', async () => {
    const result = await planRunnerImageCandidate(
      {currentRevision: CURRENT_REVISION, force: false, now: NOW},
      {listImages: async () => Promise.reject(new Error('AWS unavailable'))},
    );

    expect(result.mode).toBe('build');
    expect(result.reason).toBe('planner-failed-open');
    expect(result.detail).toContain('AWS unavailable');
  });

  it('builds when the dependency graph cannot be evaluated', async () => {
    const result = await planRunnerImageCandidate(
      {currentRevision: CURRENT_REVISION, force: false, now: NOW},
      plannerDependencies([candidate('amd64'), candidate('arm64')], {
        resolveEffectiveDirectories: () => {
          throw new Error('invalid workspace graph');
        },
      }),
    );

    expect(result.mode).toBe('build');
    expect(result.reason).toBe('planner-failed-open');
    expect(result.detail).toContain('invalid workspace graph');
  });

  it('builds when the effective-input comparison fails', async () => {
    const result = await planRunnerImageCandidate(
      {currentRevision: CURRENT_REVISION, force: false, now: NOW},
      {
        listImages: async () => [candidate('amd64'), candidate('arm64')],
        selectBase: () => Promise.resolve(baseSelection()),
        listPublishedRevisions: () => [PRIOR_REVISION],
        resolveEffectiveDirectories: () => ['apps/runner'],
        isAncestor: () => true,
        listChangedFiles: () => {
          throw new Error('required Git history is unavailable');
        },
      },
    );

    expect(result.mode).toBe('build');
    expect(result.reason).toBe('planner-failed-open');
    expect(result.detail).toContain('required Git history is unavailable');
  });

  it('builds for a manual publication when only a prior pair exists', async () => {
    const result = await planRunnerImageCandidate(
      {currentRevision: CURRENT_REVISION, force: true, now: NOW},
      plannerDependencies([candidate('amd64'), candidate('arm64')]),
    );

    expect(result.mode).toBe('build');
    expect(result.reason).toBe('manual-publication');
  });

  it('reuses the current pair during a manual publication', async () => {
    const images = [candidate('amd64', CURRENT_REVISION), candidate('arm64', CURRENT_REVISION)];

    const result = await planRunnerImageCandidate(
      {currentRevision: CURRENT_REVISION, force: true, now: NOW},
      plannerDependencies(images),
    );

    expect(result.mode).toBe('reuse-current');
    expect(result.reason).toBe('current-pair-exists');
  });

  it('fails open for ambiguous duplicate architecture inventory', async () => {
    const images = [candidate('amd64'), candidate('amd64', PRIOR_REVISION, undefined, '3')];

    const result = await planRunnerImageCandidate(
      {currentRevision: CURRENT_REVISION, force: false, now: NOW},
      plannerDependencies(images),
    );

    expect(result.mode).toBe('build');
    expect(result.reason).toBe('planner-failed-open');
    expect(result.detail).toContain('multiple amd64 AMIs');
  });
});

describe('runner production workspace closure', () => {
  it('derives transitive production packages without dev-only dependencies', () => {
    const manifests: WorkspaceManifest[] = [
      {
        path: 'apps/runner/package.json',
        name: '@shipfox/runner',
        dependencies: {'@shipfox/runner-agent': 'workspace:*'},
        devDependencies: {'@shipfox/test-only': 'workspace:*'},
      },
      {
        path: 'libs/runner/agent/package.json',
        name: '@shipfox/runner-agent',
        dependencies: {'@shipfox/protocol': 'workspace:*'},
      },
      {path: 'libs/runner/protocol/package.json', name: '@shipfox/protocol'},
      {path: 'tools/test-only/package.json', name: '@shipfox/test-only'},
    ];

    const closure = resolveProductionWorkspaceClosure(manifests);

    expect(closure).toEqual(['apps/runner', 'libs/runner/agent', 'libs/runner/protocol']);
  });

  it('rejects an incomplete workspace graph', () => {
    const manifests: WorkspaceManifest[] = [
      {
        path: 'apps/runner/package.json',
        name: '@shipfox/runner',
        dependencies: {'@shipfox/missing': 'workspace:*'},
      },
    ];

    expect(() => resolveProductionWorkspaceClosure(manifests)).toThrow(
      'Workspace dependency @shipfox/missing',
    );
  });
});

describe('runner image effective input boundary', () => {
  const productionDirectories = ['apps/runner', 'libs/runner/agent', 'libs/shared/common/config'];

  it.each([
    ['runner-image configuration', 'infra/images/runner/build.pkr.hcl'],
    ['runner-image script', 'infra/images/runner/scripts/build/install-runner.sh'],
    ['runner-image asset', 'infra/images/runner/assets/shipfox-runner.service'],
    [
      'runner-image composition',
      'infra/images/runner/composition/ubuntu24/amd64/required-enabled.txt',
    ],
    ['direct runner source', 'apps/runner/src/index.ts'],
    ['transitive production source', 'libs/runner/agent/src/index.ts'],
    ['lockfile', 'pnpm-lock.yaml'],
    ['workspace catalog', 'pnpm-workspace.yaml'],
    ['Node, pnpm, or Packer pins', 'mise.toml'],
    ['mise resolution lock', 'mise.lock'],
    ['root package-manager pin', 'package.json'],
    ['Turbo build graph', 'turbo.jsonc'],
    ['SWC build tooling', 'tools/swc/src/swc.ts'],
    ['runner staging tooling', 'tools/utils/src/staging.js'],
    ['normal candidate workflow', '.github/workflows/ci.yml'],
    ['manual candidate workflow', '.github/workflows/publish-runner-image-candidate.yml'],
  ])('includes a representative %s change', (_label, path) => {
    expect(findEffectiveChanges([path], productionDirectories)).toEqual([path]);
  });

  it('does not include unrelated application changes', () => {
    expect(findEffectiveChanges(['apps/client/src/index.ts'], productionDirectories)).toEqual([]);
  });

  it('leaves runner base changes to the base generation comparison', () => {
    expect(
      findEffectiveChanges(
        ['infra/images/runner-base/scripts/build/prepare-os.sh'],
        productionDirectories,
      ),
    ).toEqual([]);
  });
});

describe('candidate planner arguments', () => {
  it('requires an exact revision and output path', () => {
    expect(
      parseRunnerImageCandidatePlannerArgs([
        '--revision',
        CURRENT_REVISION,
        '--output',
        '/tmp/plan.json',
        '--force',
      ]),
    ).toEqual({currentRevision: CURRENT_REVISION, force: true, outputPath: '/tmp/plan.json'});
  });
});

describe('candidate inventory parsing', () => {
  it('rejects an AMI whose AWS architecture conflicts with its tag', () => {
    const image = candidate('amd64');
    image.Architecture = 'arm64';

    expect(() => inspectCandidateInventory([image], CURRENT_REVISION, () => false)).toThrow(
      'architecture does not match its tag',
    );
  });
});
