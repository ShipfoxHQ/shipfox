import type {ProjectAccessResponseDto} from '@shipfox/api-projects-dto';
import {
  toConfigCommitPage,
  toConfigMoveResult,
  toDefinitionSyncSummary,
  toDefinitionTriggers,
  toProjectAccess,
  toProjectConfig,
} from './mappers.js';

describe('toDefinitionSyncSummary', () => {
  it('maps diagnostics with severity and file path while preserving an absent path', () => {
    const summary = toDefinitionSyncSummary({
      ref: 'main',
      status: 'succeeded',
      last_sync_at: '2026-05-07T01:00:00.000Z',
      started_at: '2026-05-07T00:59:55.000Z',
      finished_at: '2026-05-07T01:00:00.000Z',
      last_error_code: null,
      last_error_message: null,
      diagnostics: [
        {code: 'warning-code', message: 'Warning without a path', severity: 'warning'},
        {
          code: 'error-code',
          message: 'Trigger error with a path',
          path: 'triggers.on_demand',
          file_path: '.shipfox/workflows/deploy.yml',
          severity: 'error',
        },
      ],
    });

    expect(summary.diagnostics).toEqual([
      {code: 'warning-code', message: 'Warning without a path', severity: 'warning'},
      {
        code: 'error-code',
        message: 'Trigger error with a path',
        path: 'triggers.on_demand',
        filePath: '.shipfox/workflows/deploy.yml',
        severity: 'error',
      },
    ]);
    expect(summary.diagnostics[0]).not.toHaveProperty('path');
  });
});

describe('toDefinitionTriggers', () => {
  it('reads the source, event, and cron schedule of each trigger', () => {
    const workflowModel = {
      kind: 'workflow',
      triggers: [
        {id: 't1', key: 'on_demand', source: 'manual', event: 'fire'},
        {
          id: 't2',
          key: 'nightly',
          source: 'cron',
          event: 'tick',
          config: {schedule: '0 3 * * 1-5'},
        },
        {id: 't3', key: 'on_issue', source: 'sentry'},
      ],
    };

    const triggers = toDefinitionTriggers(workflowModel);

    expect(triggers).toEqual([
      {key: 'on_demand', source: 'manual', event: 'fire', schedule: null},
      {key: 'nightly', source: 'cron', event: 'tick', schedule: '0 3 * * 1-5'},
      {key: 'on_issue', source: 'sentry', event: null, schedule: null},
    ]);
  });

  it.each([
    ['no model', undefined],
    ['a model without triggers', {kind: 'workflow'}],
    ['triggers that are not a list', {triggers: {manual: {source: 'manual'}}}],
  ])('returns no triggers for %s', (_label, workflowModel) => {
    const triggers = toDefinitionTriggers(workflowModel);

    expect(triggers).toEqual([]);
  });

  it('skips a trigger without a source and keys one without a name by position', () => {
    const workflowModel = {
      triggers: [
        {key: 'a', event: 'fire'},
        {source: 'manual', event: 'fire'},
      ],
    };

    const triggers = toDefinitionTriggers(workflowModel);

    expect(triggers).toEqual([{key: '1', source: 'manual', event: 'fire', schedule: null}]);
  });
});

describe('toConfigCommitPage', () => {
  it('keeps a commit page link only when the provider has one', () => {
    const page = toConfigCommitPage({
      commit: 'a'.repeat(40),
      commits: [
        {
          oid: 'b'.repeat(40),
          message: 'Pin the checkout action',
          author_name: 'Mira Okafor',
          authored_at: '2026-10-30T12:00:00.000Z',
          html_url: 'https://github.com/acme/payments/commit/bbb',
        },
        {
          oid: 'c'.repeat(40),
          message: 'Add Shipfox config',
          author_name: 'Shipfox',
          authored_at: '2026-10-24T12:00:00.000Z',
        },
      ],
      next_cursor: '2',
    });

    expect(page).toEqual({
      commits: [
        {
          oid: 'b'.repeat(40),
          message: 'Pin the checkout action',
          authorName: 'Mira Okafor',
          authoredAt: '2026-10-30T12:00:00.000Z',
          htmlUrl: 'https://github.com/acme/payments/commit/bbb',
        },
        {
          oid: 'c'.repeat(40),
          message: 'Add Shipfox config',
          authorName: 'Shipfox',
          authoredAt: '2026-10-24T12:00:00.000Z',
          htmlUrl: null,
        },
      ],
      nextCursor: '2',
    });
  });
});

describe('toProjectConfig', () => {
  it('maps a move and its pull request', () => {
    const config = toProjectConfig({
      source: {
        kind: 'linked',
        provider: 'github',
        connection_id: '33333333-3333-4333-8333-333333333333',
        external_repository_id: '918273645',
        owner: 'acme',
        name: 'payments',
        default_branch: 'main',
      },
      head: null,
      history_supported: true,
      move: {
        status: 'linked',
        target: {
          connection_id: '33333333-3333-4333-8333-333333333333',
          external_repository_id: '918273645',
          full_name: null,
        },
        started_by: '77777777-7777-4777-8777-777777777777',
        started_at: '2026-11-02T18:00:00.000Z',
      },
      pull_request: {url: 'https://github.com/acme/payments/pull/128', number: 128, state: 'open'},
    });

    expect(config.move).toEqual({
      status: 'linked',
      target: {
        connectionId: '33333333-3333-4333-8333-333333333333',
        externalRepositoryId: '918273645',
        fullName: null,
      },
      startedBy: '77777777-7777-4777-8777-777777777777',
      startedAt: '2026-11-02T18:00:00.000Z',
    });
    expect(config.pullRequest).toEqual({
      url: 'https://github.com/acme/payments/pull/128',
      number: 128,
      state: 'open',
    });
  });
});

describe('toConfigMoveResult', () => {
  it('maps the checked repository and the file count', () => {
    const result = toConfigMoveResult({
      status: 'ready',
      repository: {
        external_repository_id: '918273645',
        full_name: 'acme/payments',
        default_branch: 'trunk',
        visibility: 'public',
      },
      file_count: 3,
      pull_request: null,
    });

    expect(result).toEqual({
      repository: {
        externalRepositoryId: '918273645',
        fullName: 'acme/payments',
        defaultBranch: 'trunk',
        visibility: 'public',
      },
      fileCount: 3,
      pullRequest: null,
    });
  });
});

describe('toProjectAccess', () => {
  test('maps a narrowed access with its connection labels and repositories', () => {
    const dto: ProjectAccessResponseDto = {
      project_id: '11111111-1111-4111-8111-111111111111',
      config_source: {
        kind: 'linked',
        connection_id: '22222222-2222-4222-8222-222222222222',
        external_repository_id: 'github:1',
        lookup_name: 'acme/config',
      },
      connections: [
        {
          connection_id: '22222222-2222-4222-8222-222222222222',
          provider: 'github',
          display_name: 'acme',
          resources: [
            {
              kind: 'repository',
              external_id: 'github:2',
              lookup_name: 'acme/app',
              display_name: 'acme/App',
            },
          ],
        },
        {
          connection_id: '33333333-3333-4333-8333-333333333333',
          provider: null,
          display_name: null,
          resources: 'all',
        },
      ],
    };

    const result = toProjectAccess(dto);

    expect(result).toEqual({
      projectId: '11111111-1111-4111-8111-111111111111',
      configSource: {
        kind: 'linked',
        connectionId: '22222222-2222-4222-8222-222222222222',
        externalRepositoryId: 'github:1',
        lookupName: 'acme/config',
      },
      connections: [
        {
          connectionId: '22222222-2222-4222-8222-222222222222',
          provider: 'github',
          displayName: 'acme',
          resources: [
            {
              kind: 'repository',
              externalId: 'github:2',
              lookupName: 'acme/app',
              displayName: 'acme/App',
            },
          ],
        },
        {
          connectionId: '33333333-3333-4333-8333-333333333333',
          provider: null,
          displayName: null,
          resources: 'all',
        },
      ],
    });
  });
});
