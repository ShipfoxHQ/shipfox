import type {z} from 'zod';
import {workflowDocumentActionPathIssue, workflowDocumentStepSchema} from './workflow-document.js';
import {InvalidWorkflowDocumentError, parseWorkflowDocument} from './workflow-document-parser.js';
import {buildWorkflowJsonSchema} from './workflow-json-schema.js';

const secret = (name: string) => `${'$'}{{ secrets.${name} }}`;

function documentWithStep(step: Record<string, unknown>) {
  return {name: 'actions', jobs: {build: {steps: [step]}}};
}

function stepIssues(step: Record<string, unknown>): z.core.$ZodIssue[] {
  const result = workflowDocumentStepSchema.safeParse(step);
  return result.success ? [] : result.error.issues;
}

function parseIssues(input: unknown, options?: {actions?: boolean}) {
  try {
    parseWorkflowDocument(input, options);
    return [];
  } catch (error) {
    if (!(error instanceof InvalidWorkflowDocumentError)) throw error;
    return error.validationError.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
  }
}

describe('action steps', () => {
  it('accepts uses with connections, with, and common step fields', () => {
    const step = {
      key: 'thread',
      name: 'Save thread',
      if: `${'$'}{{ event.thread_ts != "" }}`,
      uses: './.shipfox/actions/slack-thread',
      connections: {slack: 'team-slack'},
      with: {channel_id: `${'$'}{{ event.channel }}`, token: secret('NPM_TOKEN'), limit: 3},
      env: {DEBUG: '1'},
      working_directory: 'app',
      gate: {success: 'step.outcome == "success"'},
    };

    const result = workflowDocumentStepSchema.parse(step);

    expect(result).toEqual(step);
  });

  it('accepts a method input, which only tool steps reserve', () => {
    const issues = stepIssues({uses: './actions/deploy', with: {method: 'rolling'}});

    expect(issues).toEqual([]);
  });

  it.each([
    ['run', {run: 'echo hi'}],
    ['prompt', {prompt: 'Fix it.'}],
    ['model', {model: 'gpt-5.5'}],
    ['integrations', {integrations: [{include: ['issue_read']}]}],
    ['checkout', {checkout: {}}],
    ['tool', {tool: 'read_thread'}],
    ['connection', {connection: 'team-slack'}],
    ['outputs', {outputs: {path: 'string'}}],
  ])('rejects %s on an action step', (field, extra) => {
    const issues = stepIssues({uses: './actions/deploy', ...extra});

    expect(issues).toEqual([
      expect.objectContaining({
        path: [field],
        message: `"${field}" is not valid on an action step.`,
      }),
    ]);
  });

  it.each([
    ['run', {run: 'echo hi'}],
    ['agent', {prompt: 'Fix it.'}],
    ['checkout', {checkout: {}}],
    ['tool', {tool: 'read_thread'}],
  ])('rejects connections on a %s step', (kind, step) => {
    const issues = stepIssues({...step, connections: {slack: 'team-slack'}});

    expect(issues).toEqual([
      expect.objectContaining({
        path: ['connections'],
        message: `"connections" is not valid on ${kind === 'agent' ? 'an' : 'a'} ${kind} step.`,
      }),
    ]);
  });

  it('rejects connection aliases that are not identifiers', () => {
    const issues = stepIssues({uses: './actions/deploy', connections: {'team-slack': 'slack'}});

    expect(issues).toEqual([expect.objectContaining({path: ['connections', 'team-slack']})]);
    expect(JSON.stringify(issues)).toContain('Integration aliases must be identifiers.');
  });

  it('rejects an interpolated action path once', () => {
    const issues = stepIssues({uses: `./actions/${'$'}{{ event.name }}`});

    expect(issues.map((issue) => issue.message)).toEqual([
      'Action path must be literal. Interpolation is rejected.',
    ]);
  });

  it.each([
    ['in a nested value', {auth: {token: secret('TOKEN')}}],
    ['inside a larger string', {header: `Bearer ${secret('TOKEN')}`}],
    ['in an array', {tokens: [secret('TOKEN')]}],
    ['in a larger expression', {token: `${'$'}{{ secrets.TOKEN + "x" }}`}],
  ])('rejects a secret reference %s', (_label, withValue) => {
    const issues = stepIssues({uses: './actions/deploy', with: withValue});

    expect(issues).toEqual([
      expect.objectContaining({
        message: expect.stringContaining('Secret references in `with` must be the whole value'),
      }),
    ]);
  });

  it('accepts an escaped secret reference as a literal string', () => {
    const issues = stepIssues({
      uses: './actions/deploy',
      with: {note: `use $${'$'}{{ secrets.TOKEN }} in docs`},
    });

    expect(issues).toEqual([]);
  });
});

describe('workflowDocumentActionPathIssue', () => {
  it.each([
    './.shipfox/actions/slack-thread',
    './actions/deploy',
    './a',
    './.hidden/x',
  ])('accepts %s', (path) => {
    expect(workflowDocumentActionPathIssue(path)).toBeUndefined();
  });

  it.each([
    ['./', 'normalized'],
    ['./actions/', 'normalized'],
    ['./actions//deploy', 'normalized'],
    ['./actions/./deploy', 'normalized'],
    ['./actions/../deploy', 'normalized'],
    ['./actions\\deploy', 'normalized'],
    ['../actions/deploy', 'inside the repository'],
    ['..', 'inside the repository'],
    ['.', 'inside the repository'],
    ['/actions/deploy', 'relative'],
    ['https://example.com/action', 'URLs are not supported'],
    ['file:actions/deploy', 'URLs are not supported'],
    ['owner/repo@v1', 'not supported yet'],
    ['owner/repo/path@main', 'not supported yet'],
    ['@scope/action', 'not supported yet'],
    ['slack-thread', 'not supported yet'],
    ['actions/deploy', 'not supported yet'],
  ])('rejects %s', (path, fragment) => {
    expect(workflowDocumentActionPathIssue(path)).toContain(fragment);
  });

  it('reports the path issue on the uses field', () => {
    const issues = stepIssues({uses: 'owner/repo@v1'});

    expect(issues).toEqual([
      expect.objectContaining({
        path: ['uses'],
        message:
          'Remote actions are not supported yet. Use a repository path that starts with `./`.',
      }),
    ]);
  });
});

describe('parseWorkflowDocument actions option', () => {
  const document = documentWithStep({uses: './actions/deploy', connections: {slack: 'team'}});

  it('rejects uses by default', () => {
    const issues = parseIssues(document);

    expect(issues).toEqual([
      {path: 'jobs.build.steps.0.uses', message: 'Action steps (`uses`) are not supported yet.'},
    ]);
  });

  it('reports only the unsupported feature when disabled, not the step rules', () => {
    const issues = parseIssues(documentWithStep({uses: './actions/deploy', run: 'echo hi'}), {
      actions: false,
    });

    expect(issues).toEqual([
      {path: 'jobs.build.steps.0.uses', message: 'Action steps (`uses`) are not supported yet.'},
    ]);
  });

  it('accepts uses when enabled', () => {
    const result = parseWorkflowDocument(document, {actions: true});

    expect(result.jobs.build?.steps[0]).toEqual({
      uses: './actions/deploy',
      connections: {slack: 'team'},
    });
  });

  it('applies the step rules when enabled', () => {
    const issues = parseIssues(documentWithStep({uses: './actions/deploy', run: 'echo hi'}), {
      actions: true,
    });

    expect(issues).toEqual([
      {path: 'jobs.build.steps.0.run', message: '"run" is not valid on an action step.'},
    ]);
  });

  it('parses documents without uses the same way in both modes', () => {
    const plain = documentWithStep({run: 'echo hi'});

    expect(parseWorkflowDocument(plain, {actions: true})).toEqual(parseWorkflowDocument(plain));
  });
});

describe('buildWorkflowJsonSchema actions option', () => {
  it('omits action fields by default', () => {
    const step = stepSchema(buildWorkflowJsonSchema());

    expect(Object.keys(record(step.properties))).not.toEqual(
      expect.arrayContaining(['uses', 'connections']),
    );
    expect(JSON.stringify(step.allOf)).not.toContain('"required":["uses"]');
  });

  it('adds action fields and an action step branch when enabled', () => {
    const step = stepSchema(buildWorkflowJsonSchema({actions: true}));
    const kindBranches = records(
      records(step.allOf).find((entry) => Array.isArray(entry.oneOf))?.oneOf,
    );
    const actionBranch = kindBranches.find(
      (branch) => JSON.stringify(branch.required) === JSON.stringify(['uses']),
    );

    expect(record(step.properties)).toEqual(
      expect.objectContaining({uses: expect.any(Object), connections: expect.any(Object)}),
    );
    expect(JSON.stringify(actionBranch?.not)).toContain('"required":["run"]');
    expect(JSON.stringify(actionBranch?.not)).toContain('"required":["outputs"]');
    for (const branch of kindBranches.filter((candidate) => candidate !== actionBranch)) {
      expect(JSON.stringify(branch.not)).toContain('"required":["uses"]');
    }
  });
});

function stepSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const jobs = record(record(schema.properties).jobs);
  const job = record(jobs.additionalProperties);
  return record(record(record(job.properties).steps).items);
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}
