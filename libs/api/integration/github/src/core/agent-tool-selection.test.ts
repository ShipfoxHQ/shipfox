import {githubAgentToolSelectionCatalog} from './agent-tools.js';

describe('githubAgentToolSelectionCatalog', () => {
  const selectors = new Map(
    githubAgentToolSelectionCatalog.selectors.map((selector) => [selector.token, selector]),
  );

  it('expands family tools into bare, wildcard, and method selectors', () => {
    expect(selectors.get('issue_read')).toMatchObject({
      kind: 'family',
      sensitivity: 'read',
      sensitive: false,
    });
    expect(selectors.get('issue_read.*')).toMatchObject({
      kind: 'family_wildcard',
      sensitivity: 'read',
      sensitive: false,
    });
    expect(selectors.get('issue_read.get')).toMatchObject({
      kind: 'method',
      sensitivity: 'read',
      sensitive: false,
    });
  });

  it('uses method sensitivity for method selectors', () => {
    expect(selectors.get('actions_run_trigger.run_workflow')).toMatchObject({
      kind: 'method',
      sensitivity: 'write',
      sensitive: true,
    });
  });

  it('keeps standalone tools as standalone selectors', () => {
    expect(selectors.get('merge_pull_request')).toMatchObject({
      kind: 'standalone',
      sensitivity: 'write',
      sensitive: true,
    });
  });

  it('exposes both check-run methods and narrowed method selectors', () => {
    expect(selectors.get('check_run_write')).toMatchObject({
      kind: 'family',
      sensitivity: 'write',
      sensitive: false,
    });
    expect(selectors.get('check_run_write.*')).toMatchObject({
      kind: 'family_wildcard',
      sensitivity: 'write',
      sensitive: false,
    });
    expect(selectors.get('check_run_write.create')).toMatchObject({
      kind: 'method',
      sensitivity: 'write',
      sensitive: false,
    });
    expect(selectors.get('check_run_write.update')).toMatchObject({
      kind: 'method',
      sensitivity: 'write',
      sensitive: false,
    });
  });

  it('exposes create_branch as a standalone write selector', () => {
    expect(selectors.get('create_branch')).toMatchObject({
      kind: 'standalone',
      sensitivity: 'write',
      sensitive: false,
    });
  });
});
