import {describe, expect, it} from '@shipfox/vitest/vi';
import {createIntegrationProviderRegistry} from '#core/providers/registry.js';
import {
  buildIntegrationCatalog,
  type IntegrationCatalog,
  templateCatalogIssues,
} from './template-conformance.js';

const invalidYamlIssuePattern = /^workflow is not valid YAML: /;

const catalog: IntegrationCatalog = {
  providers: new Map([
    ['linear', {events: new Set(['Issue.create']), tools: new Set(['get_issue', 'save_comment'])}],
    ['shipfox', {events: new Set(['run.completed']), tools: new Set(['get_workflow_run'])}],
  ]),
  builtinConnections: new Map([['shipfox', 'shipfox']]),
};

const workflow = [
  'triggers:',
  '  created:',
  '    source: linear_tracker # bind:tracker',
  '    event: Issue.create',
  '  run:',
  '    source: shipfox',
  '    event: run.completed',
  'jobs:',
  '  work:',
  '    steps:',
  '      - key: comment',
  '        tool: save_comment',
  '        connection: linear_tracker # bind:tracker',
  '      - key: agent',
  '        prompt: Work',
  '        integrations:',
  '          - connection: linear_tracker # bind:tracker',
  '            include: [get_issue]',
  '          - connection: shipfox',
  '            include: [get_workflow_run]',
].join('\n');

describe('templateCatalogIssues', () => {
  it('accepts references the bound providers and built-in connections list', () => {
    const issues = templateCatalogIssues({workflow, bindings: {tracker: 'linear'}, catalog});

    expect(issues).toEqual([]);
  });

  it('reports unknown events and tools per connection', () => {
    const changed = workflow
      .replace('event: Issue.create', 'event: Issue.created')
      .replace('include: [get_issue]', 'include: [get_issues]')
      .replace('event: run.completed', 'event: run.finished');

    const issues = templateCatalogIssues({
      workflow: changed,
      bindings: {tracker: 'linear'},
      catalog,
    });

    expect(issues).toEqual([
      'linear_tracker (linear): unknown event Issue.created',
      'shipfox (shipfox): unknown event run.finished',
      'linear_tracker (linear): unknown tool get_issues',
    ]);
  });

  it('reports a bound provider the instance does not register', () => {
    const issues = templateCatalogIssues({workflow, bindings: {tracker: 'jira'}, catalog});

    expect(issues).toEqual([
      'connection linear_tracker uses provider jira, which is not available',
    ]);
  });

  it('reports references without a role binding', () => {
    const unbound = workflow.replace(
      '        connection: linear_tracker # bind:tracker',
      '        connection: linear_main',
    );

    expect(
      templateCatalogIssues({workflow: unbound, bindings: {tracker: 'linear'}, catalog}),
    ).toEqual(['tool save_comment uses connection linear_main, which is not bound to a role']);
    expect(templateCatalogIssues({workflow, bindings: {}, catalog})).toEqual([
      'connection linear_tracker is bound to role tracker, which has no provider',
    ]);
  });

  it('reports a workflow that is not YAML', () => {
    const issues = templateCatalogIssues({workflow: 'jobs: [', bindings: {}, catalog});

    expect(issues).toEqual([expect.stringMatching(invalidYamlIssuePattern)]);
  });
});

describe('buildIntegrationCatalog', () => {
  it('lists the registered providers with their events, tool selectors, and built-ins', async () => {
    const registry = createIntegrationProviderRegistry([
      {
        provider: 'linear',
        displayName: 'Linear',
        eventCatalog: {
          provider: 'linear',
          families: [
            {key: 'issue', title: 'Issue', summary: 'Issues.', payloadKind: 'raw-provider'},
          ],
          events: [{name: 'Issue.create', family: 'issue', summary: 'An issue was created.'}],
        },
        adapters: {
          agent_tools: {
            catalog: () => [],
            selectionCatalog: () => ({
              selectors: [
                {token: 'get_issue', kind: 'standalone', sensitivity: 'read', sensitive: false},
              ],
            }),
            openSession: () => Promise.reject(new Error('not used')),
          },
        },
      },
      {provider: 'webhook', displayName: 'Webhook'},
    ]);

    const result = await buildIntegrationCatalog({
      registry,
      builtinConnections: [{slug: 'shipfox', id: crypto.randomUUID(), provider: 'shipfox'}],
    });

    expect(result.providers).toEqual(
      new Map([
        ['linear', {events: new Set(['Issue.create']), tools: new Set(['get_issue'])}],
        ['webhook', {events: new Set(), tools: new Set()}],
      ]),
    );
    expect(result.builtinConnections).toEqual(new Map([['shipfox', 'shipfox']]));
  });
});
