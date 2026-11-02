import {toConfigCommitPage, toDefinitionSyncSummary, toDefinitionTriggers} from './mappers.js';

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
