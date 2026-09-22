import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {
  assertFieldCoverage,
  buildWorkflowSchemaDocument,
  parseExample,
  renderSectionMarkdown,
  renderWorkflowSchemaMdx,
  schemaToFields,
  WORKFLOW_SCHEMA_SECTIONS,
} from './workflow-schema.mjs';

const UNLISTED_FIELD_PATTERN = /not listed in any section: surprise\./;
const INVALID_EXAMPLE_PATTERN = /example "workflow.yml" is invalid: missing jobs/;
const NAME_ROW_PATTERN = /^\| `name` \| `string` \| Required \|/m;
const IMPORT_PATTERN = /^import \{WorkflowSchemaSection\} from/;
const RUN_STEP_EXPORT_PATTERN =
  /export function RunStepFields\(\) \{\n {2}return <WorkflowSchemaSection id="run-step-fields" \/>;\n\}/;

describe('schemaToFields', () => {
  it('keeps constraints, enums, defaults, and section links', () => {
    const fields = schemaToFields(
      {
        key: {
          type: 'string',
          minLength: 1,
          maxLength: 128,
          pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$',
          description: 'Session key.',
        },
        mode: {type: 'string', enum: ['resume', 'fork'], description: 'Session mode.'},
        gate: {type: 'object', description: 'Gate.'},
      },
      {
        required: ['key'],
        defaults: {mode: 'resume'},
        nested: {gate: '#gate-fields'},
        types: {gate: 'Gate'},
      },
    );

    assert.deepEqual(fields, [
      {
        name: 'key',
        type: 'string',
        requirement: 'required',
        description: 'Session key.',
        constraints:
          'Use letters, numbers, dots, underscores, or hyphens. Start with a letter or number. Use at most 128 characters.',
      },
      {
        name: 'mode',
        type: 'enum',
        requirement: 'optional',
        description: 'Session mode.',
        enum: ['resume', 'fork'],
        default: 'resume',
      },
      {
        name: 'gate',
        type: 'Gate',
        requirement: 'optional',
        description: 'Gate.',
        link: '#gate-fields',
      },
    ]);
  });

  it('describes literal-only patterns in words', () => {
    const [field] = schemaToFields({
      name: {type: 'string', pattern: '^(?:[^$]|\\$\\$\\{\\{|\\$(?!\\{\\{))*$'},
    });
    assert.equal(field.constraints, 'Use a literal value. Workflow expressions are not allowed.');
  });

  it('follows the field allowlist order and skips unknown names', () => {
    const fields = schemaToFields(
      {a: {type: 'string'}, b: {type: 'boolean'}},
      {fields: ['b', 'missing', 'a']},
    );
    assert.deepEqual(
      fields.map((field) => field.name),
      ['b', 'a'],
    );
  });
});

describe('assertFieldCoverage', () => {
  it('names every schema field that no section lists', () => {
    const schema = {
      type: 'object',
      properties: {
        name: {type: 'string'},
        jobs: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            properties: {needs: {type: 'string'}, surprise: {type: 'string'}, steps: {}},
          },
        },
      },
    };
    assert.throws(() => assertFieldCoverage(schema), {message: UNLISTED_FIELD_PATTERN});
  });
});

describe('parseExample', () => {
  it('normalizes line endings and keeps one trailing newline', () => {
    const example = parseExample({source: 'name: Test\r\njobs:\r\n  test:\r\n    steps: []\n\n'});
    assert.equal(example.code, 'name: Test\njobs:\n  test:\n    steps: []\n');
  });
});

describe('renderSectionMarkdown', () => {
  it('keeps the machine-readable table shape', () => {
    const markdown = renderSectionMarkdown([
      {name: 'name', type: 'string', requirement: 'required', description: 'Workflow name.'},
      {
        name: 'scope',
        type: 'enum',
        enum: ['workflow', 'project'],
        requirement: 'optional',
        default: 'workflow',
        description: 'Scope.',
        constraints: 'Maximum 8 characters.',
      },
      {
        name: 'env',
        type: 'Environment',
        requirement: 'optional',
        description: 'Env.',
        link: '#environment-variables',
      },
    ]);
    assert.equal(
      markdown,
      [
        '| Field | Type | Required | Default | Description |',
        '|---|---|---|---|---|',
        '| `name` | `string` | Required | - | Workflow name. |',
        '| `scope` | `workflow \\| project` | Optional | `workflow` | Scope. Maximum 8 characters. |',
        '| `env` | [`Environment`](#environment-variables) | Optional | - | Env. |',
      ].join('\n'),
    );
  });
});

describe('buildWorkflowSchemaDocument', () => {
  const schema = {
    type: 'object',
    required: ['name', 'jobs'],
    properties: {
      name: {type: 'string', description: 'Name.'},
      jobs: {
        type: 'object',
        additionalProperties: {
          type: 'object',
          required: ['steps'],
          properties: {
            steps: {type: 'array', items: {type: 'object', properties: {run: {type: 'string'}}}},
          },
        },
      },
    },
  };
  const examples = Object.fromEntries(
    WORKFLOW_SCHEMA_SECTIONS.map((section) => [
      section.example,
      'name: Test\njobs:\n  test:\n    steps:\n      - run: true\n',
    ]),
  );
  const parseYaml = (code) => ({code});

  it('fails generation when an example is not a valid workflow', () => {
    assert.throws(
      () =>
        buildWorkflowSchemaDocument({
          schema,
          examples,
          parseYaml,
          validate: () => {
            throw new Error('missing jobs');
          },
        }),
      {message: INVALID_EXAMPLE_PATTERN},
    );
  });

  it('emits one section per definition with a validated example', () => {
    const validated = [];
    const document = buildWorkflowSchemaDocument({
      schema,
      examples,
      parseYaml,
      validate: (parsed) => validated.push(parsed),
    });
    assert.equal(document.sections.length, WORKFLOW_SCHEMA_SECTIONS.length);
    assert.equal(validated.length, WORKFLOW_SCHEMA_SECTIONS.length);
    const [first] = document.sections;
    assert.equal(first.id, 'top-level-fields');
    assert.equal(first.example.file, '.shipfox/workflows/workflow.yml');
    assert.match(first.markdown, NAME_ROW_PATTERN);
  });

  it('renders one generated export per section', () => {
    const document = buildWorkflowSchemaDocument({
      schema,
      examples,
      parseYaml,
      validate: () => undefined,
    });
    const mdx = renderWorkflowSchemaMdx(document);
    assert.match(mdx, IMPORT_PATTERN);
    assert.match(mdx, RUN_STEP_EXPORT_PATTERN);
  });
});
