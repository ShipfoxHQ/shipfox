import {
  type ConfigSourceStateInput,
  configSourceBadge,
  configSourceState,
  isMovingConfig,
  MOVE_STOPPED_AFTER_MS,
  matchesWorkflowSearch,
  moveStopsAt,
  repositoryLink,
  shortCommitId,
  syncBadge,
  workflowTriggerLabel,
} from './automations.js';

describe('workflowTriggerLabel', () => {
  it.each([
    [
      {source: 'manual', event: 'fire', schedule: null},
      {source: 'manual', detail: null},
    ],
    [
      {source: 'cron', event: 'tick', schedule: '0 3 * * 1-5'},
      {source: 'cron', detail: '0 3 * * 1-5'},
    ],
    [
      {source: 'sentry', event: 'issue.created', schedule: null},
      {source: 'sentry', detail: 'issue.created'},
    ],
    [
      {source: 'github', event: null, schedule: null},
      {source: 'github', detail: null},
    ],
  ])('labels %o', (trigger, expected) => {
    const label = workflowTriggerLabel(trigger);

    expect(label).toEqual(expected);
  });
});

describe('matchesWorkflowSearch', () => {
  const workflow = {
    name: 'Nightly review',
    configPath: '.shipfox/workflows/nightly.yml',
    triggers: [{source: 'cron', event: 'tick', schedule: '0 3 * * *'}],
  };

  it.each([
    ['an empty query', '  '],
    ['the name, ignoring case', 'nightly REVIEW'],
    ['the config path', 'workflows/nightly'],
    ['the trigger source', 'cron'],
    ['the cron schedule', '0 3'],
  ])('matches %s', (_label, query) => {
    const matches = matchesWorkflowSearch(workflow, query);

    expect(matches).toBe(true);
  });

  it('does not match unrelated text', () => {
    const matches = matchesWorkflowSearch(workflow, 'deploy');

    expect(matches).toBe(false);
  });

  it('does not match the internal event name of a cron trigger', () => {
    const matches = matchesWorkflowSearch(workflow, 'tick');

    expect(matches).toBe(false);
  });
});

describe('syncBadge', () => {
  it.each([
    [undefined, {label: 'Unavailable', variant: 'neutral'}],
    [null, {label: 'Not synced', variant: 'neutral'}],
    [
      {status: 'pending', lastErrorCode: null},
      {label: 'Queued', variant: 'neutral'},
    ],
    [
      {status: 'syncing', lastErrorCode: null},
      {label: 'Syncing', variant: 'info'},
    ],
    [
      {status: 'succeeded', lastErrorCode: null},
      {label: 'Synced', variant: 'success'},
    ],
    [
      {status: 'failed', lastErrorCode: 'parse-error'},
      {label: 'Failed', variant: 'error'},
    ],
    [
      {status: 'failed', lastErrorCode: 'no-workflow-files'},
      {label: 'No workflows yet', variant: 'neutral'},
    ],
  ] as const)('labels %o', (sync, expected) => {
    const badge = syncBadge(sync);

    expect(badge).toEqual(expected);
  });
});

describe('repositoryLink', () => {
  it('links a GitHub repository', () => {
    const link = repositoryLink({provider: 'github', owner: 'acme', name: 'payments'});

    expect(link).toEqual({url: 'https://github.com/acme/payments', providerName: 'GitHub'});
  });

  it.each([
    ['a Gitea repository', {provider: 'gitea', owner: 'acme', name: 'payments'}],
    ['a repository with no stored name', {provider: 'github', owner: null, name: null}],
  ])('has no link for %s', (_label, source) => {
    const link = repositoryLink(source);

    expect(link).toBeNull();
  });
});

describe('shortCommitId', () => {
  it('keeps the first seven characters', () => {
    const short = shortCommitId('3f9a21c0d6e4b8a1');

    expect(short).toBe('3f9a21c');
  });
});

describe('configSourceState', () => {
  const NOW = Date.parse('2026-11-02T18:00:00.000Z');
  const target = {
    connectionId: 'connection-1',
    externalRepositoryId: '42',
    fullName: 'acme/payments',
  };

  function config(overrides: Partial<ConfigSourceStateInput> = {}): ConfigSourceStateInput {
    return {source: {kind: 'managed'}, move: null, pullRequest: null, ...overrides};
  }

  function linking(startedAgoMs: number | null): ConfigSourceStateInput['move'] {
    return {
      status: 'linking',
      target,
      startedBy: 'user-1',
      startedAt: startedAgoMs === null ? null : new Date(NOW - startedAgoMs).toISOString(),
    };
  }

  function pullRequest(state: 'open' | 'merged' | 'closed' | 'unknown') {
    return {url: 'https://github.com/acme/payments/pull/128', number: 128, state};
  }

  it('reads a project with no move as its source kind', () => {
    expect(configSourceState(config(), NOW)).toEqual({kind: 'managed'});
    expect(configSourceState(config({source: {kind: 'linked'}}), NOW)).toEqual({kind: 'linked'});
  });

  it('reads a move as running for two minutes after it started', () => {
    const state = configSourceState(config({move: linking(MOVE_STOPPED_AFTER_MS - 1)}), NOW);

    expect(state).toEqual({
      kind: 'move-running',
      repositoryName: 'acme/payments',
      startedBy: 'user-1',
    });
  });

  it('reads a move as stopped after two minutes, with its target for Retry', () => {
    const state = configSourceState(config({move: linking(MOVE_STOPPED_AFTER_MS)}), NOW);

    expect(state).toEqual({
      kind: 'move-stopped',
      repositoryName: 'acme/payments',
      target: {connectionId: 'connection-1', externalRepositoryId: '42'},
    });
  });

  it('reads a move with no start time as stopped', () => {
    const state = configSourceState(config({move: linking(null)}), NOW);

    expect(state.kind).toBe('move-stopped');
  });

  it('reads a running move before the pull request, even once the source moved', () => {
    const state = configSourceState(
      config({source: {kind: 'linked'}, move: linking(0), pullRequest: pullRequest('open')}),
      NOW,
    );

    expect(state.kind).toBe('move-running');
  });

  it.each([
    ['open', 'pull-request-open'],
    ['closed', 'pull-request-closed'],
    ['unknown', 'pull-request-unknown'],
  ] as const)('reads a %s pull request', (prState, kind) => {
    const state = configSourceState(
      config({
        source: {kind: 'linked'},
        move: {...linking(0), status: 'linked'} as ConfigSourceStateInput['move'],
        pullRequest: pullRequest(prState),
      }),
      NOW,
    );

    expect(state.kind).toBe(kind);
  });

  it('reads a merged pull request as a linked project', () => {
    const state = configSourceState(
      config({source: {kind: 'linked'}, pullRequest: pullRequest('merged')}),
      NOW,
    );

    expect(state).toEqual({kind: 'linked'});
  });

  it('says when a running move stops', () => {
    expect(moveStopsAt(config({move: linking(1000)}))).toBe(NOW - 1000 + MOVE_STOPPED_AFTER_MS);
    expect(moveStopsAt(config())).toBeNull();
  });

  it('names only the states between a managed repository and a merge as moving', () => {
    expect(isMovingConfig({kind: 'managed'})).toBe(false);
    expect(isMovingConfig({kind: 'linked'})).toBe(false);
    expect(isMovingConfig({kind: 'pull-request-open', pullRequest: pullRequest('open')})).toBe(
      true,
    );
  });
});

describe('configSourceBadge', () => {
  const failedNoFiles = {status: 'failed', lastErrorCode: 'no-workflow-files'} as const;
  const pr = {url: 'https://github.com/acme/payments/pull/128', number: 128};

  it.each([
    [{kind: 'move-running', repositoryName: null, startedBy: null}, 'Moving', 'info'],
    [
      {
        kind: 'move-stopped',
        repositoryName: null,
        target: {connectionId: 'c', externalRepositoryId: 'r'},
      },
      'Move stopped',
      'warning',
    ],
    [{kind: 'pull-request-open', pullRequest: {...pr, state: 'open'}}, 'Waiting for merge', 'info'],
    [
      {kind: 'pull-request-closed', pullRequest: {...pr, state: 'closed'}},
      'Pull request closed',
      'warning',
    ],
    [
      {kind: 'pull-request-unknown', pullRequest: {...pr, state: 'unknown'}},
      'Status unknown',
      'neutral',
    ],
  ] as const)('labels %o without reading the sync error', (state, label, variant) => {
    const badge = configSourceBadge(state, failedNoFiles);

    expect(badge).toEqual({label, variant});
  });

  it('falls back to the sync state with no move underway', () => {
    const badge = configSourceBadge({kind: 'linked'}, {status: 'syncing', lastErrorCode: null});

    expect(badge).toEqual({label: 'Syncing', variant: 'info'});
  });
});
