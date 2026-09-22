import assert from 'node:assert/strict';
import test from 'node:test';
import {buildEventReference, type EventCatalogLike} from './build';
import {triggerKey} from './examples';

const UNDECLARED_FAMILY_PATTERN = /undeclared family missing/u;

const issueSchema = {
  type: 'object',
  properties: {
    webhookEvent: {type: 'string', enum: ['jira:issue_created', 'jira:issue_updated']},
    timestamp: {
      type: 'integer',
      minimum: -Number.MAX_SAFE_INTEGER,
      maximum: Number.MAX_SAFE_INTEGER,
      description: 'Event time.',
    },
    issue: {
      type: 'object',
      properties: {key: {type: 'string', minLength: 1, description: 'Issue key, such as ENG-123.'}},
      required: ['key'],
      additionalProperties: {},
    },
    cloudId: {type: 'string', minLength: 1, description: 'Cloud ID, added by Shipfox.'},
  },
  required: ['webhookEvent', 'timestamp', 'issue', 'cloudId'],
  additionalProperties: {},
};

const catalog: EventCatalogLike = {
  provider: 'Jira',
  families: [
    {
      key: 'issue',
      title: 'Issues',
      summary: 'Issue changes.',
      payloadKind: 'shipfox-normalized',
      payloadSchema: issueSchema,
      payloadDocUrl: 'https://example.test/jira',
      shipfoxFields: ['cloudId'],
      notes: ['Issue events may repeat.'],
    },
    {key: 'push', title: 'Push', summary: 'Pushes.', payloadKind: 'raw-provider'},
  ],
  events: [
    {name: 'jira:issue_created', family: 'issue', summary: 'An issue is created.'},
    {name: 'jira:issue_updated', family: 'issue', summary: 'An issue changes.'},
    {name: 'push', family: 'push', summary: 'A push.', payloadDocUrl: 'https://example.test/push'},
  ],
};

test('groups events under their family with anchors that follow heading order', () => {
  const document = buildEventReference({
    id: 'integrations/jira/events',
    catalog,
    connection: 'jira_acme',
  });

  assert.equal(document.eventCount, 3);
  assert.deepEqual(
    document.families.map((family) => [family.anchor, family.events.map((event) => event.anchor)]),
    [
      ['issues', ['jiraissue_created', 'jiraissue_updated']],
      ['push', ['push-1']],
    ],
  );
});

test('derives payload fields from the schema without Zod bound noise', () => {
  const document = buildEventReference({
    id: 'integrations/jira/events',
    catalog,
    connection: 'jira_acme',
  });
  const family = document.families[0];

  assert.ok(family);
  assert.equal(family.openPayload, true);
  assert.deepEqual(family.shipfoxFields, ['cloudId']);
  const timestamp = family.fields.find((field) => field.name === 'timestamp');
  assert.equal(timestamp?.constraints, undefined);
  const cloudId = family.fields.find((field) => field.name === 'cloudId');
  assert.equal(cloudId?.constraints, undefined);
  assert.deepEqual(document.families[1]?.fields, []);
  assert.equal(document.families[1]?.openPayload, false);
});

test('renders a trigger per event and pins the sample payload discriminator', () => {
  const document = buildEventReference({
    id: 'integrations/jira/events',
    catalog,
    connection: 'jira_acme',
  });
  const updated = document.families[0]?.events[1];

  assert.ok(updated);
  assert.deepEqual(updated.examples[0], {
    title: 'Trigger',
    language: 'yaml',
    code: [
      'triggers:',
      '  on_jira_issue_updated:',
      '    source: jira_acme',
      '    event: jira:issue_updated',
    ].join('\n'),
  });
  assert.equal(updated.examples[1]?.title, 'Sample payload');
  assert.deepEqual(JSON.parse(updated.examples[1]?.code ?? ''), {
    webhookEvent: 'jira:issue_updated',
    timestamp: 1,
    issue: {key: 'ENG-123'},
    cloudId: '<cloudId>',
  });
  assert.equal(document.families[1]?.events[0]?.examples.length, 1);
});

test('supports source-only triggers with a fixed key', () => {
  const document = buildEventReference({
    id: 'integrations/webhooks/events',
    catalog: {
      provider: 'Custom webhook',
      families: [
        {key: 'request', title: 'Requests', summary: 'Requests.', payloadKind: 'raw-provider'},
      ],
      events: [{name: 'received', family: 'request', summary: 'A request.'}],
    },
    connection: 'deploy_hook',
    trigger: {key: 'on_webhook', omitEvent: true},
  });

  assert.equal(
    document.families[0]?.events[0]?.examples[0]?.code,
    ['triggers:', '  on_webhook:', '    source: deploy_hook'].join('\n'),
  );
});

test('serializes machine-readable markdown with family and event headings', () => {
  const document = buildEventReference({
    id: 'integrations/jira/events',
    catalog,
    connection: 'jira_acme',
  });
  const lines = document.markdown.split('\n');

  assert.ok(lines.includes('### Issues'));
  assert.ok(
    lines.includes('**Payload:** Fields listed below. [Jira docs](https://example.test/jira)'),
  );
  assert.ok(lines.includes('Issue events may repeat.'));
  assert.ok(lines.includes('| `cloudId` | string | Required | Cloud ID, added by Shipfox. |'));
  assert.ok(!document.markdown.includes('added by Shipfox. Added by Shipfox.'));
  assert.ok(lines.includes('Jira may send other fields. Your workflow receives them too.'));
  assert.ok(lines.includes('#### `jira:issue_created`'));
  assert.ok(lines.includes('**Payload:** Fields from Jira.'));
  assert.ok(lines.includes('[Jira docs](https://example.test/push)'));
  assert.ok(
    document.markdown.includes(
      '```yaml\ntriggers:\n  on_push:\n    source: jira_acme\n    event: push\n```',
    ),
  );
});

test('states passthrough forwarding ahead of the catalog', () => {
  const document = buildEventReference({
    id: 'integrations/github/events',
    catalog: {
      ...catalog,
      provider: 'GitHub',
      passthrough: true,
      upstreamEventsDocUrl: 'https://example.test/all',
    },
    connection: 'github_acme',
  });

  assert.equal(document.passthrough, true);
  assert.ok(
    document.markdown.startsWith(
      'Shipfox also delivers GitHub events that are not listed here. See [every GitHub event](https://example.test/all).',
    ),
  );
});

test('rejects events whose family is not declared', () => {
  assert.throws(
    () =>
      buildEventReference({
        id: 'integrations/jira/events',
        catalog: {...catalog, events: [{name: 'x', family: 'missing', summary: 'X.'}]},
        connection: 'jira_acme',
      }),
    UNDECLARED_FAMILY_PATTERN,
  );
});

test('derives snake_case trigger keys from provider event names', () => {
  assert.equal(triggerKey('pull_request.opened'), 'on_pull_request_opened');
  assert.equal(triggerKey('Issue.update'), 'on_issue_update');
  assert.equal(triggerKey('agentSession.created'), 'on_agent_session_created');
  assert.equal(triggerKey('taskCommentPosted'), 'on_task_comment_posted');
});
