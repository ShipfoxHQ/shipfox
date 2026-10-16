import {actionManifestSchema} from './action-manifest.js';
import {jobSteps} from './job-steps.js';
import {rawJobSteps} from './raw-job-steps.js';
import {concurrentWorkflowDocumentSchema, workflowDocumentSchema} from './workflow-document.js';
import {InvalidWorkflowDocumentError, parseWorkflowDocument} from './workflow-document-parser.js';
import {buildWorkflowJsonSchema} from './workflow-json-schema.js';

type JsonSchema = Record<string, unknown>;

const CONTROL_STEP_MESSAGE = /is not valid on a (wait|cancel) step/;

function documentWith(steps: unknown[]) {
  return {name: 'concurrent', jobs: {build: {steps}}};
}

function issuesFor(steps: unknown[]) {
  const result = concurrentWorkflowDocumentSchema.safeParse(documentWith(steps));
  return result.success
    ? []
    : result.error.issues.map((issue) => ({
        path: issue.path.slice(3).join('.'),
        message: issue.message,
      }));
}

describe('concurrent steps in the document', () => {
  it('accepts background, wait, wait_all, cancel, and parallel', () => {
    const steps = [
      {key: 'db', background: true, run: 'docker run postgres'},
      {parallel: [{run: 'npm ci'}, {key: 'pull', run: 'docker pull fixtures'}]},
      {wait: 'db'},
      {wait: ['db', 'pull'], name: 'Wait for both'},
      {wait_all: null},
      {wait_all: true},
      {cancel: 'db'},
      {cancel: ['db', 'pull']},
    ];

    expect(concurrentWorkflowDocumentSchema.parse(documentWith(steps)).jobs.build?.steps).toEqual(
      steps,
    );
  });

  it.each([
    ['a bare wait_all', {wait_all: null}],
    ['wait_all: true', {wait_all: true}],
    ['a single wait target', {wait: 'db'}],
    ['a cancel list', {cancel: ['a', 'b']}],
  ])('accepts %s as a control step', (_label, step) => {
    expect(issuesFor([step])).toEqual([]);
  });

  it.each([
    ['wait_all: false', {wait_all: false}],
    ['an empty wait list', {wait: []}],
    ['an empty cancel target', {cancel: ''}],
    ['a wait that is not a string', {wait: 3}],
  ])('rejects %s', (_label, step) => {
    expect(issuesFor([step]).length).toBeGreaterThan(0);
  });

  it.each([
    ['key', {wait: 'db', key: 'w'}],
    ['if', {wait: 'db', if: '$' + '{{ true }}'}],
    ['run_after', {wait: 'db', run_after: 'always'}],
    ['continue_on_error', {wait: 'db', continue_on_error: true}],
    ['background', {wait: 'db', background: true}],
    ['run', {wait: 'db', run: 'echo'}],
    ['env', {wait: 'db', env: {A: 'b'}}],
    ['gate', {wait: 'db', gate: {success: '$' + '{{ true }}'}}],
  ])('rejects %s on a wait step', (field, step) => {
    expect(issuesFor([step])).toEqual([
      {
        path: `0.${field}`,
        message: `"${field}" is not valid on a wait step. A wait step accepts only "name".`,
      },
    ]);
  });

  it('rejects other fields on a cancel step and names the step kind', () => {
    expect(issuesFor([{cancel: 'db', run_after: 'always'}])).toEqual([
      {
        path: '0.run_after',
        message: '"run_after" is not valid on a cancel step. A cancel step accepts only "name".',
      },
    ]);
  });

  it('rejects two control keys in one step', () => {
    expect(issuesFor([{wait: 'a', cancel: 'b'}])).toEqual([
      {path: '0.cancel', message: '"cancel" cannot be combined with "wait" in one step.'},
    ]);
  });

  it.each([
    ['run', {run: 'echo', wait: 'db'}],
    ['prompt', {prompt: 'Review', cancel: 'db'}],
    ['tool', {tool: 'github.get_pull_request', wait_all: true}],
    ['uses', {uses: './action', cancel: 'db'}],
  ])('treats a %s step with a control key as a control step', (_kind, step) => {
    const messages = issuesFor([step]).map((issue) => issue.message);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(CONTROL_STEP_MESSAGE);
  });

  it('rejects background on a checkout step', () => {
    expect(issuesFor([{checkout: {}, background: true}])).toEqual([
      {path: '0.background', message: '"background" is not valid on a checkout step.'},
    ]);
  });

  it('accepts background on run, agent, tool, and action steps', () => {
    expect(
      issuesFor([
        {key: 'a', run: 'echo', background: true},
        {key: 'b', prompt: 'Review', background: true},
        {key: 'c', tool: 'github.get_pull_request', background: true},
        {key: 'd', uses: './action', background: true},
      ]),
    ).toEqual([]);
  });

  describe('parallel', () => {
    it('needs at least two steps', () => {
      expect(issuesFor([{parallel: [{run: 'echo'}]}])).toEqual([
        {path: '0.parallel', message: 'Too small: expected array to have >=2 items'},
      ]);
    });

    it('takes no field besides the steps', () => {
      expect(
        issuesFor([
          {parallel: [{run: 'a'}, {run: 'b'}], name: 'Both', continue_on_error: true},
        ]).map((issue) => issue.message),
      ).toEqual(['Unrecognized keys: "name", "continue_on_error"']);
    });

    it.each([
      ['checkout', {checkout: {}}, 'A checkout step cannot be in a `parallel` block.'],
      ['wait', {wait: 'x'}, 'A wait step cannot be in a `parallel` block.'],
      ['wait_all', {wait_all: null}, 'A wait step cannot be in a `parallel` block.'],
      ['cancel', {cancel: 'x'}, 'A cancel step cannot be in a `parallel` block.'],
      [
        'background',
        {run: 'b', background: true},
        '`background` is not valid on a step in a `parallel` block. The block already runs its steps in the background.',
      ],
      [
        'gate',
        {run: 'b', gate: {success: '$' + '{{ true }}'}},
        'A gate cannot be used on a step in a `parallel` block.',
      ],
    ])('rejects a %s member with one message', (field, member, message) => {
      const issues = issuesFor([{parallel: [{run: 'a'}, member]}]).filter(
        (issue) => issue.path.startsWith('0.parallel.1') && issue.message === message,
      );

      expect(issues).toEqual([{path: `0.parallel.1.${field}`, message}]);
    });

    it('rejects a nested block once', () => {
      expect(issuesFor([{parallel: [{run: 'a'}, {parallel: [{run: 'b'}, {run: 'c'}]}]}])).toEqual([
        {
          path: '0.parallel.1',
          message: 'A `parallel` block cannot be nested in another `parallel` block.',
        },
      ]);
    });

    it('keeps the path of an error inside a member', () => {
      expect(issuesFor([{run: 'a'}, {parallel: [{run: 'b'}, {key: 'x'}]}])).toEqual([
        {
          path: '1.parallel.1',
          message:
            'A step must define either "run", an agent "prompt", a "checkout", a "tool", or "uses".',
        },
      ]);
    });

    it('lets members omit key', () => {
      expect(issuesFor([{parallel: [{run: 'a'}, {run: 'b'}]}])).toEqual([]);
    });
  });
});

describe('jobSteps', () => {
  it('yields every step with its document path', () => {
    const document = concurrentWorkflowDocumentSchema.parse(
      documentWith([
        {run: 'one'},
        {run: 'two'},
        {
          parallel: [
            {key: 'a', run: 'three'},
            {key: 'b', uses: './action'},
          ],
        },
        {wait_all: null},
      ]),
    );
    const job = document.jobs.build;
    if (job === undefined) throw new Error('missing job');

    const entries = [...jobSteps(job)].map((entry) => ({
      key: entry.step.key,
      path: entry.path,
      index: entry.index,
      member: entry.member,
    }));

    expect(entries).toEqual([
      {key: undefined, path: ['steps', 0], index: 0, member: undefined},
      {key: undefined, path: ['steps', 1], index: 1, member: undefined},
      {key: 'a', path: ['steps', 2, 'parallel', 0], index: 2, member: 0},
      {key: 'b', path: ['steps', 2, 'parallel', 1], index: 2, member: 1},
      {key: undefined, path: ['steps', 3], index: 3, member: undefined},
    ]);
  });

  it('finds a uses step inside a parallel block', () => {
    const document = concurrentWorkflowDocumentSchema.parse(
      documentWith([{parallel: [{run: 'a'}, {uses: './deploy'}]}]),
    );
    const job = document.jobs.build;
    if (job === undefined) throw new Error('missing job');

    const uses = [...jobSteps(job)].filter(({step}) => step.uses !== undefined);

    expect(uses.map(({step, path}) => [step.uses, path])).toEqual([
      ['./deploy', ['steps', 0, 'parallel', 1]],
    ]);
  });
});

describe('the concurrentSteps parser option', () => {
  it.each([
    ['background', {key: 'a', run: 'echo', background: true}, 'background'],
    ['wait', {wait: 'a'}, 'wait'],
    ['wait_all', {wait_all: null}, 'wait_all'],
    ['cancel', {cancel: 'a'}, 'cancel'],
    ['parallel', {parallel: [{run: 'a'}, {run: 'b'}]}, 'parallel'],
  ])('rejects %s by default', (_label, step, key) => {
    let error: unknown;
    try {
      parseWorkflowDocument(documentWith([step]));
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(InvalidWorkflowDocumentError);
    expect((error as InvalidWorkflowDocumentError).validationError.issues).toMatchObject([
      {
        path: ['jobs', 'build', 'steps', 0, key],
        message: `Concurrent steps (\`${key}\`) are not supported yet.`,
      },
    ]);
  });

  it('rejects the plain schema the same way, so it cannot be used to skip the option', () => {
    const result = workflowDocumentSchema.safeParse(
      documentWith([
        {key: 'a', run: 'echo', background: true},
        {parallel: [{run: 'a'}, {run: 'b'}]},
      ]),
    );

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => [issue.path.join('.'), issue.message])).toEqual([
      ['jobs.build.steps.0.background', 'Concurrent steps (`background`) are not supported yet.'],
      ['jobs.build.steps.1.parallel', 'Concurrent steps (`parallel`) are not supported yet.'],
    ]);
  });

  it('accepts concurrent steps in the concurrent schema', () => {
    const steps = [
      {key: 'a', run: 'echo', background: true},
      {parallel: [{run: 'b'}, {run: 'c'}]},
      {wait_all: null},
    ];

    expect(concurrentWorkflowDocumentSchema.safeParse(documentWith(steps)).success).toBe(true);
  });

  it('accepts every concurrency field when enabled', () => {
    const steps = [
      {key: 'a', run: 'echo', background: true},
      {parallel: [{run: 'b'}, {run: 'c'}]},
      {wait: 'a'},
      {wait_all: null},
      {cancel: 'a'},
    ];

    expect(parseWorkflowDocument(documentWith(steps), {concurrentSteps: true})).toEqual(
      documentWith(steps),
    );
  });

  it('keeps action steps gated inside a parallel block', () => {
    let error: unknown;
    try {
      parseWorkflowDocument(documentWith([{parallel: [{run: 'a'}, {uses: './deploy'}]}]), {
        concurrentSteps: true,
      });
    } catch (caught) {
      error = caught;
    }

    expect((error as InvalidWorkflowDocumentError).validationError.issues).toMatchObject([
      {
        path: ['jobs', 'build', 'steps', 0, 'parallel', 1, 'uses'],
        message: 'Action steps (`uses`) are not supported yet.',
      },
    ]);
  });
});

describe('composite actions', () => {
  it.each([
    ['background', {key: 'a', run: 'echo', background: true}],
    ['wait', {wait: 'a'}],
    ['cancel', {cancel: 'a'}],
  ])('reject %s inside the manifest', (field, step) => {
    const result = actionManifestSchema.safeParse({name: 'Composite', steps: [step]});

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toContain(
      `\`${field}\` is not supported inside a composite action.`,
    );
  });
});

describe('the concurrent steps JSON Schema', () => {
  const concurrentFields = ['background', 'wait', 'wait_all', 'cancel'];

  it('leaves the concurrency fields out by default', () => {
    const items = itemsOf(buildWorkflowJsonSchema());

    expect(items.anyOf).toBeUndefined();
    for (const field of concurrentFields) {
      expect(object(items.properties)).not.toHaveProperty(field);
    }
    expect(JSON.stringify(items.allOf)).not.toContain('"wait_all"');
  });

  it('adds the fields and the parallel block when enabled', () => {
    const items = itemsOf(buildWorkflowJsonSchema({concurrentSteps: true}));
    const [step, block] = objects(items.anyOf);

    for (const field of concurrentFields) {
      expect(object(step?.properties)).toHaveProperty(field);
    }
    expect(object(block?.properties)).toHaveProperty('parallel');
    expect(object(object(block?.properties).parallel).minItems).toBe(2);
  });

  it('keeps one-kind-per-step projection and adds the control kinds', () => {
    const step = objects(itemsOf(buildWorkflowJsonSchema({concurrentSteps: true})).anyOf)[0];
    const kinds = objects(objects(step?.allOf).find((entry) => 'oneOf' in entry)?.oneOf);

    expect(kinds.map((kind) => kind.required)).toEqual(
      expect.arrayContaining([
        ['run'],
        ['prompt'],
        ['checkout'],
        ['tool'],
        ['wait'],
        ['wait_all'],
        ['cancel'],
      ]),
    );
  });

  it('describes every property of the concurrent schema', () => {
    expect(descriptionsMissingFrom(buildWorkflowJsonSchema({concurrentSteps: true}))).toEqual([]);
  });
});

function itemsOf(schema: JsonSchema): JsonSchema {
  const job = object(object(object(schema.properties).jobs).additionalProperties);
  return object(object(object(job.properties).steps).items);
}

function descriptionsMissingFrom(schema: JsonSchema, path = '#'): string[] {
  const missing: string[] = [];
  for (const [name, value] of Object.entries(object(schema.properties))) {
    const property = object(value);
    if (typeof property.description !== 'string' || property.description.trim() === '') {
      missing.push(`${path}/properties/${name}`);
    }
    missing.push(...descriptionsMissingFrom(property, `${path}/properties/${name}`));
  }
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'properties') continue;
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (typeof item === 'object' && item !== null) {
          missing.push(...descriptionsMissingFrom(item as JsonSchema, `${path}/${key}/${index}`));
        }
      });
    } else if (typeof value === 'object' && value !== null) {
      missing.push(...descriptionsMissingFrom(value as JsonSchema, `${path}/${key}`));
    }
  }
  return missing;
}

function object(value: unknown): JsonSchema {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonSchema)
    : {};
}

function objects(value: unknown): JsonSchema[] {
  return Array.isArray(value) ? value.map(object) : [];
}

describe('rawJobSteps', () => {
  it('yields each step of an unparsed document, parallel members included, with its path', () => {
    const steps = [
      ...rawJobSteps({
        jobs: {
          build: {steps: [{run: 'a'}, {parallel: [{run: 'b'}, 'not a step', {uses: './c'}]}]},
          other: {steps: 'broken'},
        },
      }),
    ];

    expect(steps.map(({path, step}) => [path.join('.'), Object.keys(step)[0]])).toEqual([
      ['jobs.build.steps.0', 'run'],
      ['jobs.build.steps.1', 'parallel'],
      ['jobs.build.steps.1.parallel.0', 'run'],
      ['jobs.build.steps.1.parallel.2', 'uses'],
    ]);
  });

  it('yields nothing for input that is not a workflow', () => {
    expect([...rawJobSteps(null)]).toEqual([]);
    expect([...rawJobSteps({jobs: []})]).toEqual([]);
  });
});
