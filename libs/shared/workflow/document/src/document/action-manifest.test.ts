import slackThreadManifest from '#test/data/action-manifests/slack-thread.json' with {type: 'json'};
import {actionManifestSchema, buildActionManifestJsonSchema} from './action-manifest.js';

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
});

describe('buildActionManifestJsonSchema', () => {
  it('describes the manifest for editors', () => {
    const schema = buildActionManifestJsonSchema();

    expect(schema).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://www.shipfox.io/docs/action.schema.json',
      title: 'Shipfox Action',
      type: 'object',
      required: ['name', 'main'],
      additionalProperties: false,
    });
    expect(Object.keys(schema.properties as object)).toEqual([
      'name',
      'description',
      'runtime',
      'main',
      'inputs',
      'outputs',
      'integrations',
    ]);
  });

  it('accepts a custom id', () => {
    const schema = buildActionManifestJsonSchema({id: 'https://example.test/action.schema.json'});

    expect(schema.$id).toBe('https://example.test/action.schema.json');
  });
});
