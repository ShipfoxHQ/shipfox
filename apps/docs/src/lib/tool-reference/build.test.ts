import assert from 'node:assert/strict';
import test from 'node:test';
import {buildIntegrationToolReference, buildMcpToolReference} from './build';

const ALLOW_WRITE_PATTERN = /allow_write: true$/u;

const issueSchema = {
  type: 'object',
  properties: {
    idOrKey: {type: 'string', description: 'Issue ID or key, such as ENG-123'},
    fields: {type: 'array', items: {type: 'string'}},
    labels: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: {type: 'string', maxLength: 64},
          color: {type: 'string', enum: ['red', 'blue']},
        },
        required: ['name'],
      },
    },
    priority: {anyOf: [{type: 'integer', minimum: 1}, {type: 'null'}]},
  },
  required: ['idOrKey'],
};

const familySchema = {
  type: 'object',
  properties: {
    owner: {type: 'string', description: 'Repository owner'},
    repo: {type: 'string', description: 'Repository name'},
    method: {type: 'string', enum: ['get', 'get_comments']},
    issue_number: {type: 'integer'},
  },
  required: ['owner', 'repo', 'method'],
  oneOf: [
    {properties: {method: {const: 'get'}}, required: ['issue_number']},
    {properties: {method: {const: 'get_comments'}}, required: []},
  ],
};

const catalog = [
  {
    id: 'get_issue',
    description: 'Retrieve an issue.',
    sensitivity: 'read' as const,
    sensitive: false,
    requiredScope: 'read',
    inputSchema: issueSchema,
  },
  {
    id: 'issue_read',
    category: 'issues',
    description: 'Read issues.',
    sensitivity: 'read' as const,
    sensitive: false,
    requiredScope: [{permission: 'issues', access: 'read'}],
    alternativeScopes: [[{permission: 'contents', access: 'read'}]],
    repositoryScope: () => ({kind: 'declared-targets'}),
    inputSchema: familySchema,
    outputSchema: {
      type: 'object',
      properties: {id: {type: 'integer'}},
      required: ['id'],
    },
    methods: [
      {
        id: 'get',
        description: 'Get an issue.',
        sensitivity: 'read' as const,
        sensitive: false,
        requiredScope: [{permission: 'issues', access: 'read'}],
        repositoryScope: () => ({kind: 'declared-targets'}),
      },
      {
        id: 'get_comments',
        description: 'Get comments.',
        sensitivity: 'read' as const,
        sensitive: true,
        requiredScope: [{permission: 'issues', access: 'read'}],
        repositoryScope: () => ({kind: 'connection', indirectTargetNote: 'Reads linked issues.'}),
      },
    ],
  },
];

const selectors = [
  {token: 'get_issue'},
  {token: 'issue_read'},
  {token: 'issue_read.*'},
  {token: 'issue_read.get'},
  {token: 'issue_read.get_comments'},
];

test('builds groups, anchors, and nested fields for an integration catalog', () => {
  const document = buildIntegrationToolReference({
    id: 'integrations/test/tools',
    catalog,
    selectors,
    connection: 'test_acme',
  });

  assert.deepEqual(
    document.groups.map((group) => [group.title, group.anchor, group.tools.map((tool) => tool.id)]),
    [
      ['Tools', 'tools', ['get_issue']],
      ['Issues', 'issues', ['issue_read']],
    ],
  );

  const getIssue = document.groups[0]?.tools[0];
  assert.ok(getIssue);
  assert.deepEqual(
    getIssue.input.map((field) => [field.path, field.type, field.requirement]),
    [
      ['idOrKey', 'string', 'required'],
      ['fields', 'array of string', 'optional'],
      ['labels', 'array of object', 'optional'],
      ['priority', 'integer | null', 'optional'],
    ],
  );
  assert.deepEqual(
    getIssue.input[2]?.children?.map((field) => [field.path, field.requirement, field.constraints]),
    [
      ['labels[].name', 'required', 'Maximum length 64.'],
      ['labels[].color', 'optional', undefined],
    ],
  );
  assert.deepEqual(getIssue.input[2]?.children?.[1]?.enumValues, ['red', 'blue']);
  assert.equal(getIssue.input[3]?.constraints, 'Minimum 1.');
});

test('describes method families with selectors, permissions, and repository scope', () => {
  const document = buildIntegrationToolReference({
    id: 'integrations/test/tools',
    catalog,
    selectors,
    connection: 'test_acme',
  });
  const family = document.groups[1]?.tools[0];
  assert.ok(family);

  assert.deepEqual(family.selectors, [
    'issue_read',
    'issue_read.*',
    'issue_read.get',
    'issue_read.get_comments',
  ]);
  assert.deepEqual(family.permissions, ['issues:read']);
  assert.deepEqual(family.alternativePermissions, [['contents:read']]);
  assert.deepEqual(family.repository, {classification: 'Declared targets.'});
  assert.deepEqual(
    family.methods?.map((method) => [
      method.id,
      method.anchor,
      method.requiredInput,
      method.repository,
    ]),
    [
      ['issue_read.get', 'issue_readget', ['issue_number'], {classification: 'Declared targets.'}],
      [
        'issue_read.get_comments',
        'issue_readget_comments',
        [],
        {classification: 'Integration connection.', indirectTargetNote: 'Reads linked issues.'},
      ],
    ],
  );
});

test('derives step examples from the schema', () => {
  const document = buildIntegrationToolReference({
    id: 'integrations/test/tools',
    catalog,
    selectors,
    connection: 'test_acme',
  });
  const [getIssue] = document.groups[0]?.tools ?? [];
  const [family] = document.groups[1]?.tools ?? [];
  assert.ok(getIssue && family);

  assert.deepEqual(
    getIssue.examples.map((example) => example.title),
    ['Tool step', 'Agent step'],
  );
  assert.equal(
    getIssue.examples[0]?.code,
    [
      '- key: get_issue',
      '  tool: get_issue',
      '  connection: test_acme',
      '  with:',
      '    idOrKey: ENG-123',
    ].join('\n'),
  );
  assert.equal(
    getIssue.examples[1]?.code,
    [
      '- prompt: Describe the task for the agent.',
      '  integrations:',
      '    - connection: test_acme',
      '      include: [get_issue]',
    ].join('\n'),
  );
  assert.equal(
    family.examples[0]?.code,
    [
      '- key: issue_read',
      '  tool: issue_read.get',
      '  connection: test_acme',
      '  with:',
      '    owner: <owner>',
      '    repo: <repo>',
      '    issue_number: 1',
      '  outputs:',
      '    id: $' + '{{ result.id }}',
    ].join('\n'),
  );
  assert.equal(family.examples[2]?.title, 'Output');
  assert.equal(family.examples[2]?.code, '{\n  "id": 1\n}');
});

test('adds allow_write to agent step examples for write tools', () => {
  const document = buildIntegrationToolReference({
    id: 'integrations/test/tools',
    catalog: [{...catalog[0], id: 'update_issue', sensitivity: 'write', requiredScope: 'write'}],
    selectors: [{token: 'update_issue'}],
    connection: 'test_acme',
  });
  assert.match(document.groups[0]?.tools[0]?.examples[1]?.code ?? '', ALLOW_WRITE_PATTERN);
});

test('serializes the machine-readable markdown with the catalog headings', () => {
  const document = buildIntegrationToolReference({
    id: 'integrations/test/tools',
    catalog,
    selectors,
    connection: 'test_acme',
  });
  const lines = document.markdown.split('\n');

  assert.ok(lines.includes('### Tools'));
  assert.ok(lines.includes('#### `get_issue`'));
  assert.ok(lines.includes('##### Input'));
  assert.ok(lines.includes('| `labels[].name` | string | Required | Maximum length 64. |'));
  assert.ok(lines.includes('| `labels[].color` | string: `red`, `blue` | Optional |  |'));
  assert.ok(lines.includes('**Required permissions:** `issues:read`'));
  assert.ok(lines.includes('**Accepted instead:** `contents:read`'));
  assert.ok(lines.includes('**Indirect target:** Reads linked issues.'));
  assert.ok(lines.includes('##### `issue_read.get`'));
  assert.ok(lines.includes('**Required input for this method:** `issue_number`.'));
  assert.ok(lines.includes('##### Output'));
  assert.ok(!document.markdown.includes('—'));
});

test('builds MCP documents with input variants, results, and access from annotations', () => {
  const document = buildMcpToolReference({
    id: 'reference/mcp-server-tools',
    groups: [
      {
        title: 'Logs',
        tools: [
          {
            name: 'get_step_logs',
            description: 'Read logs.',
            inputSchema: {
              oneOf: [
                {
                  type: 'object',
                  properties: {step_id: {type: 'string', format: 'uuid'}},
                  required: ['step_id'],
                },
                {
                  type: 'object',
                  properties: {
                    run_id: {type: 'string', format: 'uuid'},
                    failed_only: {const: true},
                  },
                  required: ['run_id', 'failed_only'],
                },
              ],
            },
            outputSchema: {
              type: 'object',
              properties: {
                result: {
                  type: 'object',
                  properties: {
                    sections: {
                      type: 'array',
                      maxItems: 10,
                      items: {
                        anyOf: [
                          {
                            type: 'object',
                            properties: {
                              kind: {const: 'tail'},
                              lines: {type: 'array', items: {type: 'string'}},
                            },
                            required: ['kind', 'lines'],
                          },
                          {
                            type: 'object',
                            properties: {kind: {const: 'download'}, url: {type: 'string'}},
                            required: ['kind', 'url'],
                          },
                        ],
                      },
                    },
                  },
                  required: ['sections'],
                },
              },
            },
            annotations: {readOnlyHint: true},
          },
          {
            name: 'cancel_workflow_run',
            description: 'Cancel a run.',
            inputSchema: {
              type: 'object',
              properties: {run_id: {type: 'string', format: 'uuid'}},
              required: ['run_id'],
            },
            outputSchema: {type: 'object', properties: {result: {type: 'object', properties: {}}}},
            annotations: {readOnlyHint: false},
          },
        ],
      },
    ],
  });

  const [logs, cancel] = document.groups[0]?.tools ?? [];
  assert.ok(logs && cancel);
  assert.equal(document.outputLabel, 'Result');
  assert.equal(logs.access, 'read');
  assert.equal(cancel.access, 'write');
  assert.deepEqual(
    logs.inputVariants?.map((variant) => [
      variant.title,
      variant.fields.map((field) => field.path),
    ]),
    [
      ['`step_id`', ['step_id']],
      ['`run_id`, `failed_only`', ['run_id', 'failed_only']],
    ],
  );
  assert.deepEqual(
    logs.output?.[0]?.children?.map((field) => [field.path, field.type, field.requirement]),
    [
      ['sections[].kind', 'constant "tail" | constant "download"', 'conditional'],
      ['sections[].lines', 'array of string', 'conditional'],
      ['sections[].url', 'string', 'conditional'],
    ],
  );
  assert.equal(logs.output?.[0]?.type, 'array of object (one of 2 shapes)');
  assert.deepEqual(
    logs.examples.map((example) => example.title),
    ['Arguments', 'Result'],
  );
  assert.equal(logs.examples[0]?.code, '{\n  "step_id": "0192b3d4-6f1a-7c2e-8f4b-1a2b3c4d5e6f"\n}');
  assert.ok(document.markdown.includes('**Shape requiring `run_id`, `failed_only`:**'));
  assert.ok(
    document.markdown.includes(
      '| `sections[].kind` | constant `"tail"` \\| constant `"download"` | Conditional |  |',
    ),
  );
  assert.ok(document.markdown.includes('##### Result'));
  assert.ok(document.markdown.includes('This tool returns an empty result.'));
});
