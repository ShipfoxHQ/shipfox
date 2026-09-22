import {inlineCode, tableValue} from '@/lib/markdown';

const CRLF_PATTERN = /\r\n/g;
const TRAILING_NEWLINES_PATTERN = /\n+$/;
const LITERAL_PATTERN = '^(?:[^$]|\\$\\$\\{\\{|\\$(?!\\{\\{))*$';
const EXPRESSION_PATTERN = '^(?:[^$]|\\$\\$\\{\\{|\\$(?!\\{\\{))*\\$\\{\\{';
const ENV_NAME_PATTERN = '^[A-Za-z_][A-Za-z0-9_]*$';
const SESSION_KEY_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';
const GENERATED_COMPONENT_IMPORT =
  "import {WorkflowSchemaSection} from '@/app/components/workflow-schema/workflow-schema-section';";

/**
 * One entry per documented block. The order is the page order, and the ids
 * are the heading anchors that other pages link to.
 *
 * Every section lists its fields explicitly, in the order a person writes
 * them: what the block is, when it runs, where it runs, what it does, what
 * it produces. Required fields lead their group. The schema declaration
 * order is not used, and `assertFieldCoverage` fails generation when the
 * schema has a field that no section lists.
 */
export const WORKFLOW_SCHEMA_SECTIONS = [
  {
    id: 'top-level-fields',
    component: 'TopLevelFields',
    path: 'workflow',
    example: 'workflow.yml',
    fields: ['name', 'run_name', 'triggers', 'concurrency', 'runner', 'env', 'jobs'],
    select: (schema) => properties(schema),
    required: ['name', 'jobs'],
    nested: {
      concurrency: '#concurrency-fields',
      env: '#environment-variables',
      triggers: '#trigger-fields',
      jobs: '#job-fields',
    },
    types: {
      concurrency: 'Concurrency',
      env: 'Environment',
      triggers: 'Record<string, Trigger>',
      jobs: 'Record<string, Job>',
    },
  },
  {
    id: 'trigger-fields',
    component: 'TriggerFields',
    path: 'triggers.<trigger_id>',
    example: 'triggers.yml',
    select: (schema) => properties(object(properties(schema).triggers).additionalProperties),
    fields: ['source', 'event', 'filter', 'with', 'secrets', 'config'],
    required: (schema) =>
      strings(object(object(properties(schema).triggers).additionalProperties).required),
  },
  {
    id: 'concurrency-fields',
    component: 'ConcurrencyFields',
    path: 'concurrency',
    example: 'concurrency.yml',
    fields: ['group', 'scope', 'cancel_in_progress'],
    select: (schema) => properties(properties(schema).concurrency),
    required: ['group'],
    defaults: {scope: 'workflow', cancel_in_progress: 'false'},
  },
  {
    id: 'environment-variables',
    component: 'EnvironmentVariables',
    path: 'env',
    example: 'env.yml',
    select: () => ({
      '<NAME>': {
        type: 'string | number | boolean',
        pattern: ENV_NAME_PATTERN,
        description: 'Defines one environment variable. Values support workflow expressions.',
      },
    }),
  },
  {
    id: 'job-fields',
    component: 'JobFields',
    path: 'jobs.<job_id>',
    example: 'jobs.yml',
    fields: [
      'name',
      'execution_name',
      'needs',
      'if',
      'runner',
      'execution_timeout',
      'env',
      'checkout',
      'listening',
      'steps',
      'success',
      'outputs',
    ],
    select: (schema) => jobProperties(schema),
    required: ['steps'],
    nested: {
      checkout: '#job-checkout-fields',
      listening: '#listening-fields',
      env: '#environment-variables',
      steps: '#step-fields',
    },
    types: {
      outputs: 'Record<string, string>',
      checkout: 'JobCheckout',
      listening: 'Listening',
      env: 'Environment',
      steps: 'Step[]',
    },
  },
  {
    id: 'job-checkout-fields',
    component: 'JobCheckoutFields',
    path: 'jobs.<job_id>.checkout',
    example: 'job-checkout.yml',
    fields: ['permissions', 'persist-credentials'],
    select: (schema) => properties(objectSchemaFor(jobProperties(schema).checkout)),
    nested: {permissions: '#checkout-permissions-fields'},
    types: {permissions: 'CheckoutPermissions'},
  },
  {
    id: 'listening-fields',
    component: 'ListeningFields',
    path: 'jobs.<job_id>.listening',
    example: 'listening.yml',
    fields: ['on', 'until', 'timeout', 'max_executions', 'batch', 'on_resolve'],
    select: (schema) => properties(jobProperties(schema).listening),
    required: ['on'],
    nested: {
      on: '#trigger-fields',
      until: '#trigger-fields',
      batch: '#listening-batch-fields',
    },
    types: {on: 'Trigger[]', until: 'Trigger[]', batch: 'ListeningBatch'},
  },
  {
    id: 'listening-batch-fields',
    component: 'ListeningBatchFields',
    path: 'jobs.<job_id>.listening.batch',
    example: 'listening-batch.yml',
    fields: ['debounce', 'max_size', 'max_wait'],
    select: (schema) => properties(properties(jobProperties(schema).listening).batch),
  },
  {
    id: 'step-fields',
    component: 'StepFields',
    path: 'jobs.<job_id>.steps[*]',
    example: 'steps.yml',
    select: (schema) => stepProperties(schema),
    fields: ['key', 'name', 'if', 'gate', 'outputs'],
    nested: {gate: '#gate-fields', outputs: '#step-outputs'},
    types: {gate: 'Gate', outputs: 'Record<string, Output>'},
  },
  {
    id: 'run-step-fields',
    component: 'RunStepFields',
    path: 'jobs.<job_id>.steps[*]',
    kind: 'run',
    example: 'run-step.yml',
    select: (schema) => stepProperties(schema),
    fields: ['run', 'working_directory', 'env'],
    required: ['run'],
    nested: {env: '#environment-variables'},
    types: {env: 'Environment'},
  },
  {
    id: 'agent-step-fields',
    component: 'AgentStepFields',
    path: 'jobs.<job_id>.steps[*]',
    kind: 'agent',
    example: 'agent-step.yml',
    select: (schema) => stepProperties(schema),
    fields: [
      'prompt',
      'harness',
      'provider',
      'model',
      'thinking',
      'tools',
      'integrations',
      'tool_surface',
      'session',
    ],
    required: ['prompt'],
    nested: {
      integrations: '#agent-integration-fields',
      session: '#agent-session-fields',
    },
    types: {integrations: 'Integration[]', session: 'string | Session'},
  },
  {
    id: 'agent-integration-fields',
    component: 'AgentIntegrationFields',
    path: 'jobs.<job_id>.steps[*].integrations[*]',
    example: 'agent-integrations.yml',
    fields: ['connection', 'include', 'exclude', 'allow_write'],
    select: (schema) => properties(object(stepProperties(schema).integrations).items),
    required: ['include'],
  },
  {
    id: 'agent-session-fields',
    component: 'AgentSessionFields',
    path: 'jobs.<job_id>.steps[*].session',
    example: 'agent-session.yml',
    fields: ['key', 'mode'],
    select: (schema) => properties(objectSchemaFor(stepProperties(schema).session)),
    required: ['key'],
    defaults: {mode: 'resume'},
    types: {key: 'string'},
  },
  {
    id: 'tool-step-fields',
    component: 'ToolStepFields',
    path: 'jobs.<job_id>.steps[*]',
    kind: 'tool',
    example: 'tool-step.yml',
    select: (schema) => stepProperties(schema),
    fields: ['tool', 'connection', 'with'],
    required: ['tool'],
    types: {with: 'Record<string, value>'},
  },
  {
    id: 'checkout-step-fields',
    component: 'CheckoutStepFields',
    path: 'jobs.<job_id>.steps[*]',
    kind: 'checkout',
    example: 'checkout-step.yml',
    select: (schema) => stepProperties(schema),
    fields: ['checkout'],
    required: ['checkout'],
    nested: {checkout: '#checkout-fields'},
    types: {checkout: 'Checkout'},
  },
  {
    id: 'checkout-fields',
    component: 'CheckoutFields',
    path: 'jobs.<job_id>.steps[*].checkout',
    example: 'checkout.yml',
    fields: [
      'project',
      'connection',
      'repository',
      'ref',
      'path',
      'fetch-depth',
      'force',
      'permissions',
      'persist-credentials',
    ],
    select: (schema) => properties(objectSchemaFor(stepProperties(schema).checkout)),
    nested: {permissions: '#checkout-permissions-fields'},
    types: {permissions: 'CheckoutPermissions'},
  },
  {
    id: 'checkout-permissions-fields',
    component: 'CheckoutPermissionsFields',
    path: 'jobs.<job_id>.steps[*].checkout.permissions',
    example: 'checkout-permissions.yml',
    fields: ['contents'],
    select: (schema) =>
      properties(properties(objectSchemaFor(stepProperties(schema).checkout)).permissions),
  },
  {
    id: 'gate-fields',
    component: 'GateFields',
    path: 'jobs.<job_id>.steps[*].gate',
    example: 'gate.yml',
    fields: ['success', 'on_failure'],
    select: (schema) => properties(stepProperties(schema).gate),
    nested: {on_failure: '#gate-failure-fields'},
    types: {on_failure: 'GateFailure'},
  },
  {
    id: 'gate-failure-fields',
    component: 'GateFailureFields',
    path: 'jobs.<job_id>.steps[*].gate.on_failure',
    example: 'gate-failure.yml',
    fields: ['restart_from', 'feedback'],
    select: (schema) => properties(properties(stepProperties(schema).gate).on_failure),
    required: ['restart_from'],
  },
  {
    id: 'step-outputs',
    component: 'StepOutputs',
    path: 'jobs.<job_id>.steps[*].outputs',
    example: 'step-outputs.yml',
    select: () => ({
      '<output_name>': {
        type: 'string | number | boolean | json | {type: string | number | boolean} | {type: json; schema?: value}',
        description:
          'Defines an output from the step. Set its type directly, for example `sha: string`, or use an object with `type`. Only `json` outputs can include `schema`. Without `schema`, a `json` output can contain any JSON value.',
      },
    }),
  },
  {
    id: 'tool-step-outputs',
    component: 'ToolStepOutputs',
    path: 'jobs.<job_id>.steps[*].outputs',
    kind: 'tool',
    example: 'tool-step-outputs.yml',
    select: () => ({
      '<output_name>': {
        type: 'string',
        description: `Creates an output from the tool response or a workflow variable. Use one workflow expression. Later steps can read the full response from \`steps.<key>.outputs.result\`.`,
      },
    }),
  },
];

/**
 * Builds the document that the section components and the machine-readable
 * page read. `examples` maps example file names to their source; `validate`
 * receives the parsed YAML of each example and must throw when it is not a
 * valid workflow.
 */
export function buildWorkflowSchemaDocument({schema, examples, parseYaml, validate}) {
  assertFieldCoverage(schema);
  const sections = WORKFLOW_SCHEMA_SECTIONS.map((definition) => {
    const fields = schemaToFields(definition.select(schema), {
      fields: definition.fields,
      required:
        typeof definition.required === 'function'
          ? definition.required(schema)
          : definition.required,
      nested: definition.nested,
      types: definition.types,
      defaults: definition.defaults,
    });
    const source = examples[definition.example];
    if (typeof source !== 'string') {
      throw new Error(`Workflow schema section "${definition.id}" has no example file.`);
    }
    const example = parseExample({source});
    try {
      validate(parseYaml(example.code));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Workflow schema example "${definition.example}" is invalid: ${message}`);
    }

    return {
      id: definition.id,
      component: definition.component,
      path: definition.path,
      ...(definition.kind ? {kind: definition.kind} : {}),
      fields,
      example: {file: `.shipfox/workflows/${definition.example}`, ...example},
      markdown: renderSectionMarkdown(fields),
    };
  });

  return {sections};
}

/**
 * Several sections document one schema object, such as the four step kinds.
 * Their field lists must cover every property together, so a new schema
 * field cannot disappear from the page.
 */
export function assertFieldCoverage(schema) {
  const listed = new Map();
  for (const definition of WORKFLOW_SCHEMA_SECTIONS) {
    if (!definition.fields) continue;
    const target = definition.select(schema);
    const names = listed.get(target) ?? new Set();
    for (const name of definition.fields) names.add(name);
    listed.set(target, names);
  }
  const missing = [];
  for (const [target, names] of listed) {
    for (const name of Object.keys(target)) {
      if (!names.has(name)) missing.push(name);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Workflow schema fields are not listed in any section: ${missing.join(', ')}. Add them to WORKFLOW_SCHEMA_SECTIONS.`,
    );
  }
}

export function schemaToFields(schemaProperties, options = {}) {
  const required = new Set(options.required ?? []);
  const names = options.fields ?? Object.keys(schemaProperties);
  return names.flatMap((name) => {
    const property = schemaProperties[name];
    if (!property) return [];

    const namedType = options.types?.[name];
    const enumValues = enumValuesFor(property);
    const constraints = constraintsFor(property);
    const defaultValue = options.defaults?.[name];
    const link = options.nested?.[name];

    return [
      {
        name,
        type: namedType ?? typeFor(property),
        requirement: required.has(name) ? 'required' : 'optional',
        description: typeof property.description === 'string' ? property.description : '',
        ...(enumValues ? {enum: enumValues} : {}),
        ...(defaultValue ? {default: defaultValue} : {}),
        ...(constraints ? {constraints} : {}),
        ...(link ? {link} : {}),
      },
    ];
  });
}

export function parseExample({source}) {
  const code = source.replace(CRLF_PATTERN, '\n').replace(TRAILING_NEWLINES_PATTERN, '');
  return {code: `${code}\n`};
}

export function renderSectionMarkdown(fields) {
  return [
    '| Field | Type | Required | Default | Description |',
    '|---|---|---|---|---|',
    ...fields.map((field) => {
      const typeText = field.enum ? field.enum.join(' | ') : field.type;
      const linkedType = field.link
        ? `[${inlineCode(typeText)}](${field.link})`
        : inlineCode(typeText);
      const defaultText = field.default ? inlineCode(field.default) : '-';
      const description = [field.description, field.constraints].filter(Boolean).join(' ');
      return `| ${inlineCode(field.name)} | ${linkedType} | ${field.requirement === 'required' ? 'Required' : 'Optional'} | ${defaultText} | ${tableValue(description || '-')} |`;
    }),
  ].join('\n');
}

export function renderWorkflowSchemaMdx(document) {
  return [
    GENERATED_COMPONENT_IMPORT,
    ...document.sections.map((section) =>
      [
        `export function ${section.component}() {`,
        `  return <WorkflowSchemaSection id=${JSON.stringify(section.id)} />;`,
        '}',
      ].join('\n'),
    ),
  ].join('\n\n');
}

export function renderWorkflowSchemaMarkdownMap(document) {
  return Object.fromEntries(
    document.sections.map((section) => [section.component, section.markdown]),
  );
}

function typeFor(schema) {
  if (Array.isArray(schema.enum)) return 'enum';
  if (schema.type === 'array') return `${typeText(object(schema.items))}[]`;
  if (schema.type === 'object' && schema.additionalProperties) return 'Record<string, value>';
  if (Array.isArray(schema.anyOf)) {
    const alternatives = objects(schema.anyOf);
    if (alternatives.some((option) => option.pattern === EXPRESSION_PATTERN)) {
      const literal = alternatives.filter((option) => option.pattern !== EXPRESSION_PATTERN);
      return literal.length === 1 && literal[0]?.enum ? 'enum | expression' : 'expression';
    }
    return alternatives.map((option) => typeText(option)).join(' | ');
  }
  return typeof schema.type === 'string' ? schema.type : 'value';
}

function typeText(schema) {
  if (Array.isArray(schema.enum)) return schema.enum.join(' | ');
  if (schema.type === 'array') return `${typeText(object(schema.items))}[]`;
  if (schema.type === 'object')
    return schema.additionalProperties ? 'Record<string, value>' : 'object';
  return typeof schema.type === 'string' ? schema.type : 'value';
}

function enumValuesFor(schema) {
  if (Array.isArray(schema.enum)) return schema.enum.map(String);
  const alternatives = objects(schema.anyOf);
  const withEnum = alternatives.find((option) => Array.isArray(option.enum));
  return withEnum ? withEnum.enum.map(String) : undefined;
}

function constraintsFor(schema) {
  const source = Array.isArray(schema.anyOf)
    ? (objects(schema.anyOf).find(
        (option) => option.pattern && option.pattern !== EXPRESSION_PATTERN,
      ) ?? schema)
    : schema;
  const parts = [
    patternConstraint(source.pattern),
    ...lengthConstraints(source),
    ...rangeConstraints(source),
    itemsConstraint(schema.minItems),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : undefined;
}

function patternConstraint(pattern) {
  if (pattern === LITERAL_PATTERN)
    return 'Use a literal value. Workflow expressions are not allowed.';
  if (pattern === ENV_NAME_PATTERN)
    return 'Use letters, numbers, and underscores. Start with a letter or underscore.';
  if (pattern === SESSION_KEY_PATTERN)
    return 'Use letters, numbers, dots, underscores, or hyphens. Start with a letter or number.';
  if (typeof pattern === 'string') return `Pattern ${inlineCode(pattern)}.`;
  return undefined;
}

function lengthConstraints(schema) {
  const parts = [];
  if (typeof schema.maxLength === 'number')
    parts.push(`Use at most ${schema.maxLength} characters.`);
  if (typeof schema.minLength === 'number' && schema.minLength > 1)
    parts.push(`Use at least ${schema.minLength} characters.`);
  return parts;
}

function rangeConstraints(schema) {
  const parts = [];
  if (typeof schema.minimum === 'number') parts.push(`Use ${schema.minimum} or a larger number.`);
  if (typeof schema.exclusiveMinimum === 'number')
    parts.push(`Use a number greater than ${schema.exclusiveMinimum}.`);
  if (typeof schema.maximum === 'number' && schema.maximum < Number.MAX_SAFE_INTEGER)
    parts.push(`Use ${schema.maximum} or a smaller number.`);
  return parts;
}

function itemsConstraint(minItems) {
  if (typeof minItems !== 'number' || minItems < 1) return undefined;
  return `Add at least ${minItems === 1 ? 'one item' : `${minItems} items`}.`;
}

function jobProperties(schema) {
  return properties(object(properties(schema).jobs).additionalProperties);
}

function stepProperties(schema) {
  return properties(object(jobProperties(schema).steps).items);
}

function properties(schema) {
  return object(object(schema).properties);
}

function object(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
}

function objectSchemaFor(value) {
  const schema = object(value);
  if (schema.type === 'object' || schema.properties) return schema;
  return (
    objects(schema.anyOf).find((option) => option.type === 'object' || option.properties) ?? {}
  );
}

function strings(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

function objects(value) {
  return Array.isArray(value) ? value.map(object) : [];
}
