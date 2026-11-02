import {
  matchesWorkflowSearch,
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
