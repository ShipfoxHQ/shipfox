import {
  deriveActionMetadata,
  type RegistryActionVersionDocument,
  type RegistryCatalogEntry,
  type RegistryEnvelope,
  type RegistryTemplateVersionDocument,
  type RegistryVersionDocument,
} from '@shipfox/registry-format';
import {actionManifestSchema} from '@shipfox/workflow-document';
import {deriveTemplateMetadata, workflowTemplateManifestSchema} from '@shipfox/workflow-templates';

export function digest(character: string): string {
  return `sha256:${character.repeat(64)}`;
}

const PROVENANCE = {
  issuer: 'https://token.actions.githubusercontent.com',
  repository: 'ShipfoxHQ/shipfox',
  repository_id: '812345678',
  repository_owner_id: '1234567',
  commit: '3066dabaa0000000000000000000000000000000',
  ref: 'refs/pull/2210/merge',
  workflow_ref: 'ShipfoxHQ/shipfox/.github/workflows/publish-packages.yml@refs/pull/2210/merge',
  run_id: '17000000001',
  run_attempt: '1',
  path: 'libs/shared/workflow/catalog/templates/ticket-to-pr',
};

const TEMPLATE_MANIFEST = workflowTemplateManifestSchema.parse({
  title: 'Task to pull request',
  summary: 'Turn a ticket or a request into a tested GitHub pull request.',
  keywords: ['pull-request'],
  starts: 'Your coding agent sends a task, or a Linear issue is ready.',
  flow: [
    {kind: 'trigger', title: 'The agent gets a task', detail: 'A task arrives with its criteria.'},
    {kind: 'agent', title: 'The agent changes the code', detail: 'It makes the smallest change.'},
    {
      kind: 'check',
      title: 'The workflow runs your tests',
      detail: 'Failures go back.',
      loops_to: 1,
    },
    {
      kind: 'write',
      provider: 'github',
      title: 'The workflow opens a pull request',
      detail: 'A draft pull request.',
    },
  ],
  writes: [
    {provider: 'github', action: 'Pushes a branch and opens a pull request.'},
    {action: 'With a tracker, comments on the ticket.'},
  ],
  prerequisites: ['Set `test_command` to the command that runs your tests.'],
  related: ['shipfox/fix-dependency-ci', 'shipfox/unpublished-template'],
  roles: {
    source: {from: 'project', providers: ['github']},
    tracker: {
      providers: ['linear', 'jira'],
      optional: true,
      question: 'Do you track tasks in a tracker?',
      tradeoff: 'The workflow comments on the ticket.',
    },
  },
  options: [
    {
      id: 'feedback_loop',
      question: 'Should the agent answer review comments?',
      choices: [
        {id: 'on', label: 'Yes', default: true, tradeoff: 'Runs again on each review.'},
        {id: 'off', label: 'No'},
      ],
    },
  ],
  slots: [{id: 'test_command', description: 'The command that runs the tests.'}],
});

export function templateDocument({
  version,
  publishedAt,
  changelog,
  readme = false,
}: {
  version: string;
  publishedAt: string;
  changelog?: string;
  readme?: boolean;
}): RegistryTemplateVersionDocument {
  return {
    schema: 'shipfox.registry/version@1',
    package: 'shipfox/ticket-to-pr',
    kind: 'template',
    version,
    visibility: 'public',
    fingerprint: digest('f'),
    published_at: publishedAt,
    license: 'MIT',
    content: {digest: digest('d'), bytes: 20480, format: 'template-bundle@1'},
    source: {digest: digest('e'), bytes: 30000, format: 'source-archive@1'},
    ...(readme ? {readme: {digest: digest('c'), bytes: 100}} : {}),
    manifest: TEMPLATE_MANIFEST,
    derived: deriveTemplateMetadata({manifest: TEMPLATE_MANIFEST, contentBytes: 20480}),
    actions: ['shipfox/slack-thread-digest@1.0.0'],
    ...(changelog === undefined ? {} : {changelog}),
    composition: 1,
    builder: {tool: '@shipfox/registry-release', version: '0.1.0', recipe: 1},
    provenance: PROVENANCE,
  };
}

const ACTION_MANIFEST = actionManifestSchema.parse({
  name: 'Slack thread digest',
  description: 'Turns a Slack thread into Markdown with authors and links.',
  runtime: 'node24',
  main: 'index.mjs',
  inputs: {
    channel_id: {type: 'string', required: true, description: 'The channel of the thread.'},
    include_reactions: {type: 'boolean', default: false},
  },
  outputs: {markdown: {type: 'string', required: true, description: 'The digest.'}},
  integrations: {slack: {provider: 'slack', include: ['conversations'], allow_write: false}},
});

export function actionDocument({version}: {version: string}): RegistryActionVersionDocument {
  return {
    schema: 'shipfox.registry/version@1',
    package: 'shipfox/slack-thread-digest',
    kind: 'action',
    version,
    visibility: 'public',
    fingerprint: digest('f'),
    published_at: '2026-10-12T09:14:03.000Z',
    license: 'MIT',
    content: {digest: digest('a'), bytes: 48213, format: 'action-bundle@1'},
    source: {digest: digest('b'), bytes: 91022, format: 'source-archive@1'},
    manifest: ACTION_MANIFEST,
    derived: deriveActionMetadata({
      reference: {namespace: 'shipfox', name: 'slack-thread-digest', version},
      manifest: ACTION_MANIFEST,
      contentBytes: 48213,
    }),
    dependencies: [{name: 'mdast-util-to-markdown', version: '2.1.2'}],
    actions: [],
    builder: {tool: '@shipfox/registry-release', version: '0.1.0', recipe: 1, mode: 'workspace'},
    provenance: {...PROVENANCE, path: 'libs/shared/workflow/catalog/actions/slack-thread-digest'},
  };
}

/** An envelope whose signature nobody checks: the pages only display the payload. */
export function envelope(document: RegistryVersionDocument): RegistryEnvelope {
  return {
    payloadType: 'application/vnd.shipfox.registry.version+json',
    payload: Buffer.from(JSON.stringify(document)).toString('base64'),
    signatures: [{keyid: 'test', sig: Buffer.from('signature').toString('base64')}],
  };
}

export function catalogEntry(
  overrides: Partial<RegistryCatalogEntry> & Pick<RegistryCatalogEntry, 'package' | 'title'>,
): RegistryCatalogEntry {
  return {
    kind: 'template',
    summary: 'A summary.',
    keywords: [],
    integrations: ['github'],
    latest: '1.0.0',
    published_at: '2026-10-01T09:00:00.000Z',
    first_published_at: '2026-10-01T09:00:00.000Z',
    publisher: {namespace: 'shipfox', display_name: 'Shipfox', verified: true},
    ...overrides,
  };
}
