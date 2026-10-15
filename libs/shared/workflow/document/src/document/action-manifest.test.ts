import slackThreadManifest from '#test/data/action-manifests/slack-thread.json' with {type: 'json'};
import {
  actionManifestSchema,
  buildActionManifestJsonSchema,
  isCompositeActionManifest,
  safeParseActionManifest,
} from './action-manifest.js';
import {workflowDocumentStepSchema} from './workflow-document.js';

function manifestIssues(manifest: unknown) {
  const result = actionManifestSchema.safeParse(manifest);
  return result.success
    ? []
    : result.error.issues.map((issue) => ({path: issue.path.join('.'), message: issue.message}));
}

describe('actionManifestSchema', () => {
  it('parses the Slack thread fixture and applies defaults', () => {
    const manifest = actionManifestSchema.parse(slackThreadManifest);

    expect(manifest).toEqual({
      name: 'Slack thread to Markdown',
      description: 'Saves every message of a Slack thread to a Markdown file.',
      main: 'index.ts',
      inputs: {
        channel_id: {type: 'string', required: true},
        thread_ts: {type: 'string', required: true},
        destination: {type: 'string', required: false, default: 'context/slack-thread.md'},
      },
      outputs: {
        path: {type: 'string', required: true},
        message_count: {type: 'number', required: true},
        complete: {type: 'boolean', required: false},
      },
      integrations: {
        slack: {
          provider: 'slack',
          include: ['read_thread', 'read_user_profile'],
          allow_write: false,
        },
      },
    });
  });

  it('accepts a json value with a JSON Schema and the node24 runtime', () => {
    const issues = manifestIssues({
      name: 'Report',
      main: 'lib/main.mjs',
      runtime: 'node24',
      inputs: {filters: {type: 'json', schema: {type: 'object'}, default: {labels: ['bug']}}},
      outputs: {report: {type: 'json', schema: {type: 'array'}}},
    });

    expect(issues).toEqual([]);
  });

  it.each([
    ['the root', {...slackThreadManifest, version: 1}, ''],
    ['an input', {...slackThreadManifest, inputs: {id: {optional: true}}}, 'inputs.id'],
    ['an output', {...slackThreadManifest, outputs: {path: {default: 'x'}}}, 'outputs.path'],
    [
      'an integration',
      {
        ...slackThreadManifest,
        integrations: {slack: {provider: 'slack', include: ['x'], exclude: []}},
      },
      'integrations.slack',
    ],
  ])('rejects unknown keys on %s', (_label, manifest, path) => {
    const issues = manifestIssues(manifest);

    expect(issues).toEqual([expect.objectContaining({path})]);
    expect(issues[0]?.message).toContain('Unrecognized key');
  });

  it.each([
    ['index.py', '`main` must be a .ts, .mts, .js, or .mjs file.'],
    ['index', '`main` must be a .ts, .mts, .js, or .mjs file.'],
    ['./index.ts', 'without `./`'],
    ['../index.ts', 'without `./`'],
    ['lib/../index.ts', 'without `./`'],
    ['/index.ts', 'without `./`'],
    ['lib//index.ts', 'without `./`'],
  ])('rejects main %s', (main, message) => {
    const issues = manifestIssues({...slackThreadManifest, main});

    expect(issues).toEqual([{path: 'main', message: expect.stringContaining(message)}]);
  });

  it('accepts a post entry with a failure mode', () => {
    const manifest = actionManifestSchema.parse({
      ...slackThreadManifest,
      post: 'post.ts',
      post_failure: 'fail',
    });

    expect(manifest.post).toBe('post.ts');
    expect(manifest.post_failure).toBe('fail');
  });

  it('leaves post_failure unset when it is omitted', () => {
    const manifest = actionManifestSchema.parse({...slackThreadManifest, post: 'post.ts'});

    expect(manifest.post_failure).toBeUndefined();
  });

  it.each([
    ['index.py', '`post` must be a .ts, .mts, .js, or .mjs file.'],
    ['./post.ts', 'without `./`'],
    ['../post.ts', 'without `./`'],
  ])('rejects post %s', (post, message) => {
    const issues = manifestIssues({...slackThreadManifest, post});

    expect(issues).toEqual([{path: 'post', message: expect.stringContaining(message)}]);
  });

  it('rejects a post that equals main', () => {
    const issues = manifestIssues({...slackThreadManifest, post: slackThreadManifest.main});

    expect(issues).toEqual([{path: 'post', message: '`post` must differ from `main`.'}]);
  });

  it('rejects post_failure without post', () => {
    const issues = manifestIssues({...slackThreadManifest, post_failure: 'warn'});

    expect(issues).toEqual([{path: 'post_failure', message: '`post_failure` requires `post`.'}]);
  });

  it('rejects an unknown post_failure', () => {
    const issues = manifestIssues({
      ...slackThreadManifest,
      post: 'post.ts',
      post_failure: 'ignore',
    });

    expect(issues).toEqual([expect.objectContaining({path: 'post_failure'})]);
  });

  it.each([['*'], ['issue_read.*']])('rejects the %s selector', (selector) => {
    const issues = manifestIssues({
      ...slackThreadManifest,
      integrations: {slack: {provider: 'slack', include: [selector]}},
    });

    expect(issues).toEqual([
      {
        path: 'integrations.slack.include.0',
        message: 'Selectors must name tools explicitly. Wildcards are not allowed.',
      },
    ]);
  });

  it('rejects an integration without selectors', () => {
    const issues = manifestIssues({
      ...slackThreadManifest,
      integrations: {slack: {provider: 'slack', include: []}},
    });

    expect(issues).toEqual([expect.objectContaining({path: 'integrations.slack.include'})]);
  });

  it('rejects an unsupported runtime', () => {
    const issues = manifestIssues({...slackThreadManifest, runtime: 'node22'});

    expect(issues).toEqual([expect.objectContaining({path: 'runtime'})]);
  });

  it.each([
    ['string', 3],
    ['number', '3'],
    ['boolean', 'true'],
  ])('rejects a default that is not a %s', (type, value) => {
    const issues = manifestIssues({
      ...slackThreadManifest,
      inputs: {limit: {type, default: value}},
    });

    expect(issues).toEqual([
      {path: 'inputs.limit.default', message: `The default must be a ${type} value.`},
    ]);
  });

  it('rejects a cyclic json default', () => {
    const cyclic: unknown[] = [1];
    cyclic.push(cyclic);

    const issues = manifestIssues({
      ...slackThreadManifest,
      inputs: {filters: {type: 'json', default: cyclic}},
    });

    expect(issues).toEqual([
      {path: 'inputs.filters.default', message: 'The default must be a json value.'},
    ]);
  });

  it('accepts a json default that reuses one object twice', () => {
    const shared = {label: 'bug'};

    const issues = manifestIssues({
      ...slackThreadManifest,
      inputs: {filters: {type: 'json', default: [shared, shared]}},
    });

    expect(issues).toEqual([]);
  });

  it('rejects a schema on a scalar value', () => {
    const issues = manifestIssues({
      ...slackThreadManifest,
      outputs: {path: {type: 'string', schema: {type: 'string'}}},
    });

    expect(issues).toEqual([
      {path: 'outputs.path.schema', message: '`schema` is only supported for json outputs.'},
    ]);
  });

  it.each([
    ['input', {inputs: {'channel-id': {}}}],
    ['output', {outputs: {'message-count': {}}}],
  ])('rejects %s names that are not identifiers', (_label, values) => {
    const issues = manifestIssues({...slackThreadManifest, ...values});

    expect(JSON.stringify(issues)).toContain('Invalid key in record');
  });

  it('accepts registry presentation fields', () => {
    const manifest = actionManifestSchema.parse({
      ...slackThreadManifest,
      keywords: ['slack', 'markdown'],
      related: ['shipfox/linear-issue-context'],
    });

    expect(manifest).toEqual(
      expect.objectContaining({
        keywords: ['slack', 'markdown'],
        related: ['shipfox/linear-issue-context'],
      }),
    );
  });

  it.each([
    ['Slack', 'keywords.0'],
    ['s', 'keywords.0'],
    ['slack_thread', 'keywords.0'],
  ])('rejects the keyword %s', (keyword, path) => {
    const issues = manifestIssues({...slackThreadManifest, keywords: [keyword]});

    expect(issues).toEqual([
      {path, message: 'Keywords use 2 to 40 lowercase letters, digits, and single hyphens.'},
    ]);
  });

  it('rejects more than 10 keywords', () => {
    const keywords = Array.from({length: 11}, (_, index) => `keyword-${index}`);

    const issues = manifestIssues({...slackThreadManifest, keywords});

    expect(issues).toEqual([expect.objectContaining({path: 'keywords'})]);
  });

  it.each([
    'linear-issue-context',
    'shipfox/linear-issue-context@1.0.0',
    './actions/deploy',
    'acme/a/b',
  ])('rejects the related package %s', (related) => {
    const issues = manifestIssues({...slackThreadManifest, related: [related]});

    expect(issues).toEqual([
      {
        path: 'related.0',
        message: 'Related packages are registry names, such as `shipfox/slack-thread-digest`.',
      },
    ]);
  });
});

describe('buildActionManifestJsonSchema', () => {
  it('describes the manifest for editors', () => {
    const schema = buildActionManifestJsonSchema();

    expect(schema).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://www.shipfox.io/docs/action.schema.json',
      title: 'Shipfox Action',
      type: 'object',
      required: ['name'],
      additionalProperties: false,
      oneOf: [
        {required: ['main'], not: {required: ['steps']}},
        {
          required: ['steps'],
          not: {
            anyOf: [
              {required: ['main']},
              {required: ['runtime']},
              {required: ['post']},
              {required: ['post_failure']},
            ],
          },
        },
      ],
    });
    expect(Object.keys(schema.properties as object)).toEqual([
      'name',
      'description',
      'runtime',
      'main',
      'post',
      'post_failure',
      'steps',
      'inputs',
      'outputs',
      'integrations',
      'keywords',
      'related',
    ]);
    expect(schema.properties).toMatchObject({post_failure: {enum: ['warn', 'fail']}});
  });

  it('accepts a custom id', () => {
    const schema = buildActionManifestJsonSchema({id: 'https://example.test/action.schema.json'});

    expect(schema.$id).toBe('https://example.test/action.schema.json');
  });
});

describe('composite action manifests', () => {
  const composite = {
    name: 'Set up a pull request review',
    inputs: {
      base_sha: {type: 'string', required: true},
      npm_token: {secret: true, required: true},
    },
    outputs: {
      changed_files: {type: 'json', value: '$' + '{{ steps.changed_files.outputs.files }}'},
    },
    steps: [
      {key: 'install', uses: 'shipfox/setup-mise@1.2.0'},
      {
        key: 'changed_files',
        run: '$' + '{{ action.path }}/scripts/changed-files.sh',
        outputs: {files: 'json'},
      },
    ],
  };

  it('parses a composite manifest', () => {
    const manifest = actionManifestSchema.parse(composite);

    expect(isCompositeActionManifest(manifest)).toBe(true);
    expect(manifest.steps).toHaveLength(2);
    expect(manifest.inputs?.npm_token).toEqual({type: 'string', required: true, secret: true});
    expect(manifest.outputs?.changed_files?.value).toBe(
      '$' + '{{ steps.changed_files.outputs.files }}',
    );
  });

  it('keeps JavaScript manifests apart from composite ones', () => {
    const manifest = actionManifestSchema.parse(slackThreadManifest);

    expect(isCompositeActionManifest(manifest)).toBe(false);
  });

  it('rejects a manifest with both main and steps', () => {
    const issues = manifestIssues({...composite, main: 'index.ts'});

    expect(issues).toEqual([{path: 'main', message: 'Set either `main` or `steps`, not both.'}]);
  });

  it('rejects a manifest with neither main nor steps', () => {
    const {main: _main, ...manifest} = slackThreadManifest;

    const issues = manifestIssues(manifest);

    expect(issues).toEqual([
      {
        path: 'main',
        message: 'Set `main` for a JavaScript action, or `steps` for a composite action.',
      },
    ]);
  });

  it.each(['runtime', 'post', 'post_failure'] as const)('rejects %s on a composite', (field) => {
    const value = {runtime: 'node24', post: 'post.ts', post_failure: 'warn'}[field];

    const issues = manifestIssues({...composite, [field]: value});

    expect(issues).toEqual([
      {
        path: field,
        message: `\`${field}\` is only valid on a JavaScript action, which sets \`main\`.`,
      },
    ]);
  });

  it('requires a value on composite outputs', () => {
    const issues = manifestIssues({...composite, outputs: {changed_files: {type: 'json'}}});

    expect(issues).toEqual([
      {
        path: 'outputs.changed_files.value',
        message:
          'A composite action output needs `value`, an expression over `inputs` and `steps`.',
      },
    ]);
  });

  it('rejects a value on JavaScript outputs', () => {
    const issues = manifestIssues({
      ...slackThreadManifest,
      outputs: {path: {type: 'string', value: 'x'}},
    });

    expect(issues).toEqual([
      {
        path: 'outputs.path.value',
        message:
          '`value` is only valid on composite action outputs. A JavaScript action sets them.',
      },
    ]);
  });

  it('rejects a secret input on a JavaScript action', () => {
    const issues = manifestIssues({
      ...slackThreadManifest,
      inputs: {token: {type: 'string', secret: true}},
    });

    expect(issues).toEqual([expect.objectContaining({path: 'inputs.token.secret'})]);
  });

  it.each([
    [{type: 'json', secret: true}, 'inputs.token.type', 'A secret input must be a string.'],
    [{secret: true, default: 'x'}, 'inputs.token.default', 'A secret input cannot have a default.'],
  ])('rejects the secret input %j', (input, path, message) => {
    const issues = manifestIssues({...composite, inputs: {token: input}});

    expect(issues).toEqual([{path, message}]);
  });

  it.each([
    [{checkout: {repository: 'acme/app', path: 'app'}}, 'steps.0.checkout'],
    [{key: 'x', run: 'true', outputs: {v: 'string'}, export: true}, 'steps.0.export'],
    [{tool: 'read_issue'}, 'steps.0.connection'],
  ])('rejects the inner step %j', (step, path) => {
    const issues = manifestIssues({...composite, outputs: {}, steps: [step]});

    expect(issues).toEqual([expect.objectContaining({path})]);
  });

  it.each([
    '$' + '{{ action.path }}/steps/lint',
    '$' + '{{action.path}}/steps/lint',
    './.shipfox/actions/lint',
    'shipfox/lint@1.0.0',
  ])('accepts the inner uses %s', (uses) => {
    const issues = manifestIssues({...composite, outputs: {}, steps: [{uses}]});

    expect(issues).toEqual([]);
  });

  it.each([
    ['$' + '{{ action.path }}/../lint', 'must stay inside the action directory'],
    ['$' + '{{ action.path }}/', 'must stay inside the action directory'],
    ['$' + '{{ action.path }}/$' + '{{ inputs.name }}', 'must be literal'],
    ['$' + '{{ inputs.path }}/lint', 'Action path must be literal'],
  ])('rejects the inner uses %s', (uses, message) => {
    const issues = manifestIssues({...composite, outputs: {}, steps: [{uses}]});

    expect(issues).toEqual([{path: 'steps.0.uses', message: expect.stringContaining(message)}]);
  });

  it.each([
    '$' + '{{ action.path }}/prompts/review.md',
    './REVIEW.md',
  ])('accepts the inner prompt file %s', (file) => {
    const issues = manifestIssues({...composite, outputs: {}, steps: [{prompt: [{file}]}]});

    expect(issues).toEqual([]);
  });

  it('rejects an inner prompt file outside the action directory', () => {
    const issues = manifestIssues({
      ...composite,
      outputs: {},
      steps: [{prompt: [{file: '$' + '{{ action.path }}/../x.md'}]}],
    });

    expect(issues).toEqual([
      {
        path: 'steps.0.prompt.0.file',
        message: expect.stringContaining('must stay inside the action directory'),
      },
    ]);
  });

  it.each([
    {uses: '$' + '{{ action.path }}/steps/lint'},
    {prompt: [{file: '$' + '{{ action.path }}/prompts/review.md'}]},
  ])('keeps the action.path prefix out of workflow steps: %j', (step) => {
    const result = workflowDocumentStepSchema.safeParse(step);

    expect(result.success).toBe(false);
  });
});

describe('safeParseActionManifest', () => {
  const composite = {name: 'Composite', steps: [{run: 'true'}]};

  it('reports only that composites are unsupported without the option', () => {
    const result = safeParseActionManifest({...composite, main: 'index.ts'});

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        path: ['steps'],
        message: 'Composite actions (`steps`) are not supported yet.',
      }),
    ]);
  });

  it('parses a composite with the option', () => {
    const result = safeParseActionManifest(composite, {compositeActions: true});

    expect(result.success).toBe(true);
  });

  it('parses a JavaScript action without the option', () => {
    const result = safeParseActionManifest(slackThreadManifest);

    expect(result.success).toBe(true);
  });
});
