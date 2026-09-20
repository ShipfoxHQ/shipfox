import type {Image} from '@aws-sdk/client-ec2';
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
const NOW = new Date('2026-09-20T12:00:00.000Z');

function candidate(
  architecture: 'amd64' | 'arm64',
  revision = PRIOR_REVISION,
  createdAt = '2026-09-18T12:00:00.000Z',
  amiSuffix = architecture === 'amd64' ? '1' : '2',
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
    ],
  };
}

function plannerDependencies(
  images: Image[],
  overrides: {
    changedFiles?: string[];
    isAncestor?: boolean;
    resolveEffectiveDirectories?: () => string[];
  } = {},
) {
  return {
    listImages: async () => images,
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

  it('builds both architectures when the newest inventory group is partial', async () => {
    const images = [
      candidate('amd64'),
      candidate('arm64'),
      candidate('amd64', CURRENT_REVISION, '2026-09-19T12:00:00.000Z', '3'),
    ];

    const result = await planRunnerImageCandidate(
      {currentRevision: CURRENT_REVISION, force: false, now: NOW},
      plannerDependencies(images),
    );

    expect(result.mode).toBe('build');
    expect(result.reason).toBe('partial-candidate-pair');
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

  it('builds for a manual publication unless the current pair already exists', async () => {
    const result = await planRunnerImageCandidate(
      {currentRevision: CURRENT_REVISION, force: true, now: NOW},
      plannerDependencies([candidate('amd64'), candidate('arm64')]),
    );

    expect(result.mode).toBe('build');
    expect(result.reason).toBe('manual-publication');
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
    ['candidate workflow', '.github/workflows/publish-runner-image-candidate.yml'],
  ])('includes a representative %s change', (_label, path) => {
    expect(findEffectiveChanges([path], productionDirectories)).toEqual([path]);
  });

  it('does not include unrelated application changes', () => {
    expect(findEffectiveChanges(['apps/client/src/index.ts'], productionDirectories)).toEqual([]);
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

    expect(() => inspectCandidateInventory([image], CURRENT_REVISION)).toThrow(
      'architecture does not match its tag',
    );
  });
});
