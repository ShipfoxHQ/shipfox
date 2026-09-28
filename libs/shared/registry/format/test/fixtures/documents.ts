import type {RegistryActionVersionDocument, RegistryTemplateVersionDocument} from '#documents.js';

export function digest(character: string): string {
  return `sha256:${character.repeat(64)}`;
}

export function actionVersionDocument(): RegistryActionVersionDocument {
  return {
    schema: 'shipfox.registry/version@1',
    package: 'shipfox/slack-thread-digest',
    kind: 'action',
    version: '1.4.2',
    visibility: 'public',
    fingerprint: digest('f'),
    published_at: '2026-10-12T09:14:03Z',
    license: 'MIT',
    content: {digest: digest('a'), bytes: 48213, format: 'action-bundle@1'},
    source: {digest: digest('b'), bytes: 91022, format: 'source-archive@1'},
    readme: {digest: digest('c'), bytes: 4210},
    manifest: {
      name: 'Slack thread digest',
      description: 'Turns a Slack thread into Markdown with authors and links.',
      main: 'index.mjs',
      inputs: {},
      outputs: {},
      integrations: {slack: {provider: 'slack', include: ['conversations'], allow_write: false}},
    },
    derived: {
      integrations: ['slack'],
      capabilities: {slack: {provider: 'slack', selectors: ['conversations'], allow_write: false}},
      interface: {inputs: {}, outputs: {}},
      usage: 'uses: shipfox/slack-thread-digest@1.4.2\nconnections:\n  slack: <slack connection>\n',
      size: 48213,
    },
    dependencies: [{name: 'mdast-util-to-markdown', version: '2.1.2'}],
    actions: [],
    changelog: '### Minor changes\n\n- Adds `include_reactions`.',
    bump: 'minor',
    builder: {tool: '@shipfox/registry-release', version: '0.1.0', recipe: 1, mode: 'workspace'},
    provenance: {
      issuer: 'https://token.actions.githubusercontent.com',
      repository: 'ShipfoxHQ/shipfox',
      repository_id: '812345678',
      repository_owner_id: '1234567',
      commit: '3066dabaa0000000000000000000000000000000',
      ref: 'refs/pull/2210/merge',
      workflow_ref: 'ShipfoxHQ/shipfox/.github/workflows/publish-packages.yml@refs/pull/2210/merge',
      run_id: '17000000001',
      run_attempt: '1',
      path: 'libs/shared/workflow/catalog/actions/slack-thread-digest',
    },
  };
}

export function templateVersionDocument(): RegistryTemplateVersionDocument {
  const {dependencies: _dependencies, bump: _bump, ...action} = actionVersionDocument();
  return {
    ...action,
    package: 'shipfox/ticket-to-pr',
    kind: 'template',
    version: '1.0.0',
    content: {digest: digest('d'), bytes: 20480, format: 'template-bundle@1'},
    manifest: {title: 'Task to pull request', summary: 'Turn a ticket into a pull request.'},
    derived: {integrations: ['github', 'linear']},
    actions: ['shipfox/slack-thread-digest@1.4.2'],
    composition: 1,
    builder: {tool: '@shipfox/registry-release', version: '0.1.0', recipe: 1},
  };
}
