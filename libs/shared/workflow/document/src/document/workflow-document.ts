import {isHttpFieldName} from '@shipfox/regex';
import {z} from 'zod';
import {
  actionPathRelativePart,
  actionPathRelativePartIssue,
  parseWorkflowActionRef,
  REMOTE_ACTIONS_UNSUPPORTED_MESSAGE,
  WORKFLOW_ACTION_PATH_PREFIX,
} from './action-ref.js';
import {checkoutTargetValidationIssues} from './checkout-target-validation.js';
import {agentThinkingSchema, agentToolSurfaceSchema, harnessSchema} from './step-enums.js';

const stringOrStringArraySchema = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);
const nonEmptyRecordSchema = <ValueSchema extends z.ZodType>(valueSchema: ValueSchema) =>
  z
    .record(z.string().min(1), valueSchema)
    .refine((value) => Object.keys(value).length > 0, {message: 'Expected at least one entry'});

export const WORKFLOW_LITERAL_NAME_PATTERN = /^(?:[^$]|\$\$\{\{|\$(?!\{\{))*$/;
// The inverse of a literal name: a literal prefix followed by an unescaped
// `${{`. An enum field that also accepts a template matches one or the other.
export const WORKFLOW_INTERPOLATED_VALUE_PATTERN = /^(?:[^$]|\$\$\{\{|\$(?!\{\{))*\$\{\{/;
export const WORKFLOW_INTERPOLATION_MARKER_PATTERN = /\$\{\{/;
export const WORKFLOW_SESSION_KEY_MAX_LENGTH = 128;
export const WORKFLOW_SESSION_KEY_PATTERN_SOURCE = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';
export const WORKFLOW_SESSION_KEY_PATTERN = new RegExp(WORKFLOW_SESSION_KEY_PATTERN_SOURCE);
const workflowSessionKeyLiteralPartPattern = /^[A-Za-z0-9._-]*$/;
const workflowSessionKeyLiteralPartStartPattern = /^[A-Za-z0-9]/;

// Reasoning effort is an enum so editors can complete it, and a template so a
// workflow can choose the effort from run context. The resolved value is
// checked against the harness levels when the step is dispatched.
export const agentThinkingFieldSchema = z
  .union([
    agentThinkingSchema,
    z.string().regex(WORKFLOW_INTERPOLATED_VALUE_PATTERN, {
      message:
        'Agent thinking must be a supported level or a $' +
        '{{ }} interpolation that resolves to one.',
    }),
  ])
  .meta({
    description:
      'Sets agent reasoning. `default` requests the provider default without workspace or deployment overrides. Omitting this field uses configured defaults or `xhigh`. Available values depend on the harness. Supports workflow expressions. See [Model providers](/reference/model-providers).',
  });

const WORKFLOW_PROMPT_PARTS_MAX_ITEMS = 64;
// Action path messages start with "Action"; a prompt file path reuses them.
const actionMessagePrefixPattern = /^Action/;

/**
 * Validates the path of a prompt `file` part. It follows the local `uses:`
 * rule: literal, starts with `./`, and stays inside the repository.
 */
function promptFilePathIssue(path: string): string | undefined {
  if (!WORKFLOW_LITERAL_NAME_PATTERN.test(path)) {
    return 'Prompt file paths must be literal. Interpolation is rejected.';
  }
  const result = parseWorkflowActionRef(path);
  if (result.ok && result.ref.kind === 'local') return undefined;
  if (!(result.ok || result.registry)) {
    return result.message.replace(actionMessagePrefixPattern, 'Prompt file');
  }
  return 'Prompt file paths must start with `./`.';
}

// Inside a composite action, `${{ action.path }}/` names a file of the action.
function compositePromptFilePathIssue(path: string): string | undefined {
  const relativePath = actionPathRelativePart(path);
  if (relativePath === undefined) return promptFilePathIssue(path);
  return actionPathRelativePartIssue(relativePath);
}

function promptFilePartSchema(mode: WorkflowDocumentStepMode) {
  const pathIssue = mode === 'composite' ? compositePromptFilePathIssue : promptFilePathIssue;
  return z.strictObject({
    file: z
      .string()
      .min(1)
      .superRefine((path, ctx) => {
        const message = pathIssue(path);
        if (message !== undefined) ctx.addIssue({code: 'custom', message});
      })
      .meta({
        description:
          mode === 'composite'
            ? `Reads the part from a file. A path that starts with \`./\` reads the repository, and \`${WORKFLOW_ACTION_PATH_PREFIX}\` reads the action directory.`
            : 'Reads the part from this repository file. The path starts with `./` and stays inside the repository.',
      }),
  });
}

// Lists do not nest: a part is a string or a file reference, so a YAML anchor
// that holds a list (or a cyclic alias) is an invalid item, with no recursion.
function promptSchema(mode: WorkflowDocumentStepMode) {
  return z.union([
    z.string().min(1),
    z
      .array(z.union([z.string().min(1), promptFilePartSchema(mode)]))
      .min(1)
      .max(WORKFLOW_PROMPT_PARTS_MAX_ITEMS),
  ]);
}

const workflowNameSchema = literalNameSchema(
  'Workflow name must be literal. Move runtime interpolation to run_name.',
).meta({description: 'Names the workflow.'});
const jobNameSchema = literalNameSchema(
  'Job name must be literal. Move runtime interpolation to execution_name.',
).meta({description: 'Names the job.'});

function literalNameSchema(message: string) {
  return z.string().min(1).regex(WORKFLOW_LITERAL_NAME_PATTERN, {message});
}

// Runner shell steps execute on Unix shells, so workflow env names follow the
// portable POSIX-style variable shape.
const envNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const envStringValueSchema = z.string().refine((value) => !value.includes('\u0000'), {
  message: 'Env string values cannot contain null bytes',
});
/** Default total executions for a gate retry policy, including the first execution. */
export const WORKFLOW_GATE_DEFAULT_MAX_ATTEMPTS = 5;
/** Maximum total executions supported by a gate retry policy, including the first execution. */
export const WORKFLOW_GATE_MAX_ATTEMPTS_MAX = 1_000;
export const WORKFLOW_DOCUMENT_ENV_MAX_ENTRIES = 128;
export const WORKFLOW_DOCUMENT_ENV_MAX_SERIALIZED_BYTES = 32 * 1024;
export const workflowDocumentStepOutputTypes = ['string', 'number', 'boolean', 'json'] as const;
export const WORKFLOW_DOCUMENT_JOB_OUTPUTS_MAX_ENTRIES = WORKFLOW_DOCUMENT_ENV_MAX_ENTRIES;
export const WORKFLOW_DOCUMENT_STEP_OUTPUTS_MAX_ENTRIES = WORKFLOW_DOCUMENT_ENV_MAX_ENTRIES;
export const WORKFLOW_DOCUMENT_STEP_OUTPUT_SCHEMA_MAX_SERIALIZED_BYTES =
  WORKFLOW_DOCUMENT_ENV_MAX_SERIALIZED_BYTES;
export const WORKFLOW_DOCUMENT_STEP_OUTPUT_SCHEMA_MAX_DEPTH = 64;
export const WORKFLOW_DOCUMENT_TOOL_WITH_MAX_SERIALIZED_BYTES = 32 * 1024;
export const WORKFLOW_DOCUMENT_TOOL_WITH_MAX_DEPTH = 16;

const utf8Encoder = new TextEncoder();

// Env maps and MCP server header maps share one size budget.
function boundedRecordChecks(label: 'Env' | 'Headers') {
  return (record: Readonly<Record<string, unknown>>, ctx: z.RefinementCtx) => {
    const entries = Object.keys(record).length;
    if (entries > WORKFLOW_DOCUMENT_ENV_MAX_ENTRIES) {
      ctx.addIssue({
        code: 'custom',
        message: `${label} cannot define more than ${WORKFLOW_DOCUMENT_ENV_MAX_ENTRIES} entries.`,
      });
    }

    const serializedBytes = utf8Encoder.encode(JSON.stringify(record)).byteLength;
    if (serializedBytes > WORKFLOW_DOCUMENT_ENV_MAX_SERIALIZED_BYTES) {
      ctx.addIssue({
        code: 'custom',
        message: `${label} cannot serialize to more than ${WORKFLOW_DOCUMENT_ENV_MAX_SERIALIZED_BYTES} bytes.`,
      });
    }
  };
}

export const workflowDocumentEnvSchema = z
  .record(envNameSchema, z.union([envStringValueSchema, z.number(), z.boolean()]))
  .superRefine(boundedRecordChecks('Env'))
  .meta({
    description: `Environment variables as string, number, or boolean values. Each map allows up to ${WORKFLOW_DOCUMENT_ENV_MAX_ENTRIES} entries and ${WORKFLOW_DOCUMENT_ENV_MAX_SERIALIZED_BYTES} serialized bytes.`,
  });

export const WORKFLOW_DOCUMENT_STEP_OUTPUT_KEY_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

// Action code reaches a binding as `tools.<alias>`, so aliases are identifiers.
export const workflowDocumentActionAliasSchema = z
  .string()
  .regex(WORKFLOW_DOCUMENT_STEP_OUTPUT_KEY_PATTERN, {
    message: 'Integration aliases must be identifiers.',
  });

// Tool inputs are a JSON tree: scalars, nested mappings, and sequences. String
// leaves accept `${{ }}` interpolation; the expression layer validates them.
type WorkflowDocumentJsonValue =
  | string
  | number
  | boolean
  | null
  | WorkflowDocumentJsonValue[]
  | {[key: string]: WorkflowDocumentJsonValue};

// Tool and action steps share the `with` field, so the step field checks only
// the JSON-tree limits. Kind-specific rules run in the step refinement.
const workflowDocumentStepWithSchema = z
  // Validate nested values in an iterative refinement. A recursive Zod schema
  // would traverse hostile depth before the input limits can reject it.
  .record(z.string().min(1), z.unknown())
  .superRefine((withValue, ctx) => validateWorkflowDocumentToolWith(withValue, ctx))
  .transform((withValue) => withValue as Record<string, WorkflowDocumentJsonValue>)
  .meta({
    description:
      'Provides input values to the tool. The tool defines the accepted fields. String values support workflow expressions. See [Context availability](/reference/contexts#context-availability).',
  });

export const workflowDocumentToolStepWithSchema = workflowDocumentStepWithSchema.superRefine(
  (withValue, ctx) => addWorkflowDocumentToolWithMethodIssue(withValue, ctx, []),
);

function addWorkflowDocumentToolWithMethodIssue(
  withValue: Readonly<Record<string, unknown>>,
  ctx: z.RefinementCtx,
  path: readonly (string | number)[],
) {
  // The server injects `method` for `family.method` tools, so the author can
  // never set it.
  if (!('method' in withValue)) return;
  ctx.addIssue({
    code: 'custom',
    path: [...path, 'method'],
    message: '`method` is not a valid tool input; the server injects it for `family.method` tools.',
  });
}

type WorkflowDocumentToolWithValidationTask =
  | {kind: 'value'; value: unknown; depth: number; path: (string | number)[]}
  | {kind: 'end'; value: object; byteLength: number}
  | {kind: 'bytes'; byteLength: number};

interface WorkflowDocumentToolWithValidationState {
  readonly activeObjects: Set<object>;
  readonly tasks: WorkflowDocumentToolWithValidationTask[];
  serializedBytes: number;
}

function validateWorkflowDocumentToolWith(
  withValue: Readonly<Record<string, unknown>>,
  ctx: z.RefinementCtx,
) {
  const state: WorkflowDocumentToolWithValidationState = {
    activeObjects: new Set<object>(),
    tasks: [{kind: 'value', value: withValue, depth: 1, path: []}],
    serializedBytes: 0,
  };

  while (state.tasks.length > 0) {
    const task = state.tasks.pop();
    if (task === undefined) continue;
    if (!validateWorkflowDocumentToolWithTask(task, state, ctx)) return;
  }
}

function validateWorkflowDocumentToolWithTask(
  task: WorkflowDocumentToolWithValidationTask,
  state: WorkflowDocumentToolWithValidationState,
  ctx: z.RefinementCtx,
): boolean {
  if (task.kind === 'bytes') return addWorkflowDocumentToolWithBytes(task.byteLength, state, ctx);
  if (task.kind === 'end') {
    state.activeObjects.delete(task.value);
    return addWorkflowDocumentToolWithBytes(task.byteLength, state, ctx);
  }
  return validateWorkflowDocumentToolWithValue(task, state, ctx);
}

function addWorkflowDocumentToolWithBytes(
  byteLength: number,
  state: WorkflowDocumentToolWithValidationState,
  ctx: z.RefinementCtx,
): boolean {
  state.serializedBytes += byteLength;
  if (state.serializedBytes <= WORKFLOW_DOCUMENT_TOOL_WITH_MAX_SERIALIZED_BYTES) return true;
  ctx.addIssue({
    code: 'custom',
    message: `\`with\` cannot serialize to more than ${WORKFLOW_DOCUMENT_TOOL_WITH_MAX_SERIALIZED_BYTES} bytes.`,
  });
  return false;
}

function validateWorkflowDocumentToolWithValue(
  task: Extract<WorkflowDocumentToolWithValidationTask, {kind: 'value'}>,
  state: WorkflowDocumentToolWithValidationState,
  ctx: z.RefinementCtx,
): boolean {
  const {value, depth, path} = task;
  if (value === null) return addWorkflowDocumentToolWithBytes(4, state, ctx);
  if (typeof value === 'string' || typeof value === 'boolean') {
    return addWorkflowDocumentToolWithBytes(jsonPrimitiveByteLength(value), state, ctx);
  }
  if (typeof value === 'number')
    return validateWorkflowDocumentToolWithNumber(value, path, state, ctx);
  if (typeof value !== 'object') return rejectWorkflowDocumentToolWithValue(path, ctx);
  if (depth > WORKFLOW_DOCUMENT_TOOL_WITH_MAX_DEPTH) {
    ctx.addIssue({
      code: 'custom',
      message: `\`with\` cannot be nested deeper than ${WORKFLOW_DOCUMENT_TOOL_WITH_MAX_DEPTH} levels.`,
    });
    return false;
  }
  if (state.activeObjects.has(value)) {
    ctx.addIssue({code: 'custom', path, message: '`with` values must be a JSON tree.'});
    return false;
  }

  state.activeObjects.add(value);
  if (Array.isArray(value))
    return queueWorkflowDocumentToolWithArray(value, depth, path, state, ctx);
  if (!isJsonRecord(value)) return rejectWorkflowDocumentToolWithTree(path, ctx);
  return queueWorkflowDocumentToolWithRecord(value, depth, path, state, ctx);
}

function validateWorkflowDocumentToolWithNumber(
  value: number,
  path: (string | number)[],
  state: WorkflowDocumentToolWithValidationState,
  ctx: z.RefinementCtx,
): boolean {
  if (!Number.isFinite(value)) return rejectWorkflowDocumentToolWithValue(path, ctx);
  return addWorkflowDocumentToolWithBytes(jsonPrimitiveByteLength(value), state, ctx);
}

function rejectWorkflowDocumentToolWithValue(
  path: (string | number)[],
  ctx: z.RefinementCtx,
): false {
  ctx.addIssue({code: 'custom', path, message: '`with` values must be JSON-compatible.'});
  return false;
}

function rejectWorkflowDocumentToolWithTree(
  path: (string | number)[],
  ctx: z.RefinementCtx,
): false {
  ctx.addIssue({code: 'custom', path, message: '`with` values must be a JSON tree.'});
  return false;
}

function queueWorkflowDocumentToolWithArray(
  value: unknown[],
  depth: number,
  path: (string | number)[],
  state: WorkflowDocumentToolWithValidationState,
  ctx: z.RefinementCtx,
): boolean {
  if (!addWorkflowDocumentToolWithBytes(1, state, ctx)) return false;
  state.tasks.push({kind: 'end', value, byteLength: 1});
  for (let index = value.length - 1; index >= 0; index -= 1) {
    state.tasks.push({
      kind: 'value',
      value: value[index],
      depth: depth + 1,
      path: [...path, index],
    });
    if (index > 0) state.tasks.push({kind: 'bytes', byteLength: 1});
  }
  return true;
}

function queueWorkflowDocumentToolWithRecord(
  value: Record<string, unknown>,
  depth: number,
  path: (string | number)[],
  state: WorkflowDocumentToolWithValidationState,
  ctx: z.RefinementCtx,
): boolean {
  if (!addWorkflowDocumentToolWithBytes(1, state, ctx)) return false;
  state.tasks.push({kind: 'end', value, byteLength: 1});
  const entries = Object.entries(value);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry === undefined) continue;
    const [key, child] = entry;
    state.tasks.push({kind: 'value', value: child, depth: depth + 1, path: [...path, key]});
    state.tasks.push({kind: 'bytes', byteLength: jsonPrimitiveByteLength(key) + 1});
    if (index > 0) state.tasks.push({kind: 'bytes', byteLength: 1});
  }
  return true;
}

function jsonPrimitiveByteLength(value: string | number | boolean): number {
  return utf8Encoder.encode(JSON.stringify(value)).byteLength;
}

function jsonSerializedByteLength(value: unknown): number | undefined {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? undefined : utf8Encoder.encode(serialized).byteLength;
  } catch {
    return undefined;
  }
}

function isJsonRecord(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

const workflowDocumentStepOutputTypeSchema = z.enum(workflowDocumentStepOutputTypes).meta({
  description: 'Declared output type. Use `json` when the output has a JSON Schema.',
});

const workflowDocumentToolStepOutputMappingValueSchema = z
  .string()
  .min(1)
  .refine((value) => WORKFLOW_INTERPOLATION_MARKER_PATTERN.test(value), {
    message: 'Tool-step output mappings must use a $' + '{{ }} expression.',
  });

export const workflowDocumentStepOutputDeclarationSchema = z
  .union([
    workflowDocumentStepOutputTypeSchema.transform((type) => ({type})),
    z.strictObject({
      type: workflowDocumentStepOutputTypeSchema,
      schema: z
        .unknown()
        .optional()
        .meta({
          description:
            'JSON Schema for a `json` output. It allows up to ' +
            WORKFLOW_DOCUMENT_STEP_OUTPUT_SCHEMA_MAX_SERIALIZED_BYTES +
            ' serialized bytes and ' +
            WORKFLOW_DOCUMENT_STEP_OUTPUT_SCHEMA_MAX_DEPTH +
            ' nesting levels.',
        }),
      default: z.unknown().optional().meta({
        description:
          'Value that later steps read when the step has no value for this output, for example when it is skipped. It must match the declared type and `schema`. Run and agent steps only.',
      }),
      from_file: z.string().min(1).optional().meta({
        description:
          'Run steps only. Reads the output from this file after the command exits. The path is relative to the step working directory and must stay inside the job workspace. A missing file leaves the output unset.',
      }),
      from_stdout: z.literal(true).optional().meta({
        description:
          'Run steps only. Reads the output from the standard output of the command, up to 64 KiB. One trailing newline is removed. At most one output of a step can use it.',
      }),
    }),
  ])
  .superRefine((declaration, ctx) => {
    validateWorkflowDocumentValueDeclaration(
      {type: declaration.type, schema: 'schema' in declaration ? declaration.schema : undefined},
      ctx,
    );
    if (
      'from_file' in declaration &&
      declaration.from_file !== undefined &&
      'from_stdout' in declaration &&
      declaration.from_stdout !== undefined
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['from_stdout'],
        message: 'An output can use `from_file` or `from_stdout`, not both.',
      });
    }
  });

// Step outputs and action manifest inputs and outputs share one type vocabulary.
export function validateWorkflowDocumentValueDeclaration(
  declaration: {type: WorkflowDocumentStepOutputType; schema?: unknown},
  ctx: z.RefinementCtx,
): void {
  const schema = declaration.schema;
  if (declaration.type !== 'json' && schema !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['schema'],
      message: '`schema` is only supported for json outputs.',
    });
    return;
  }

  if (schema === undefined) return;

  if (!isJsonSchemaDocument(schema)) {
    ctx.addIssue({
      code: 'custom',
      path: ['schema'],
      message: 'Schema must be a valid JSON Schema document.',
    });
    return;
  }

  const serializedBytes = jsonSerializedByteLength(schema);
  if (serializedBytes === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['schema'],
      message: 'Schema must be a serializable JSON Schema document.',
    });
    return;
  }

  if (serializedBytes > WORKFLOW_DOCUMENT_STEP_OUTPUT_SCHEMA_MAX_SERIALIZED_BYTES) {
    ctx.addIssue({
      code: 'custom',
      path: ['schema'],
      message: `Output JSON Schema cannot serialize to more than ${WORKFLOW_DOCUMENT_STEP_OUTPUT_SCHEMA_MAX_SERIALIZED_BYTES} bytes.`,
    });
  }

  const depth = maxJsonDepth(schema);
  if (depth > WORKFLOW_DOCUMENT_STEP_OUTPUT_SCHEMA_MAX_DEPTH) {
    ctx.addIssue({
      code: 'custom',
      path: ['schema'],
      message: `Output JSON Schema cannot be nested deeper than ${WORKFLOW_DOCUMENT_STEP_OUTPUT_SCHEMA_MAX_DEPTH} levels.`,
    });
  }
}

function stepOutputsAreMappingForm(outputs: Readonly<Record<string, unknown>>): boolean {
  const values = Object.values(outputs);
  return (
    values.length > 0 &&
    values.every(
      (value) => typeof value === 'string' && WORKFLOW_INTERPOLATION_MARKER_PATTERN.test(value),
    )
  );
}

function stepOutputsContainMappingForm(outputs: Readonly<Record<string, unknown>>): boolean {
  return Object.values(outputs).some(
    (value) => typeof value === 'string' && WORKFLOW_INTERPOLATION_MARKER_PATTERN.test(value),
  );
}

function stepOutputsRecordChecks(outputs: Readonly<Record<string, unknown>>, ctx: z.RefinementCtx) {
  const entries = Object.keys(outputs).length;
  if (entries > WORKFLOW_DOCUMENT_STEP_OUTPUTS_MAX_ENTRIES) {
    ctx.addIssue({
      code: 'custom',
      message: `Step outputs cannot define more than ${WORKFLOW_DOCUMENT_STEP_OUTPUTS_MAX_ENTRIES} entries.`,
    });
  }

  for (const key of Object.keys(outputs)) {
    if (WORKFLOW_DOCUMENT_STEP_OUTPUT_KEY_PATTERN.test(key)) continue;
    ctx.addIssue({
      code: 'custom',
      path: [key],
      message: 'Output keys must be CEL identifiers.',
    });
  }
}

export const workflowDocumentStepOutputsSchema = z
  .record(z.string(), workflowDocumentStepOutputDeclarationSchema)
  .superRefine((outputs, ctx) => stepOutputsRecordChecks(outputs, ctx))
  .meta({
    description: `Named step outputs. Keys must be CEL identifiers and each step allows up to ${WORKFLOW_DOCUMENT_STEP_OUTPUTS_MAX_ENTRIES} declarations.`,
  });

// The tool-step `outputs` form maps output keys to a single `${{ }}` expression
// over `result`. The expression layer validates the interpolation and its exact
// shape at normalization time.
export const workflowDocumentToolStepOutputsSchema = z
  .record(z.string(), workflowDocumentToolStepOutputMappingValueSchema)
  .superRefine((outputs, ctx) => stepOutputsRecordChecks(outputs, ctx))
  .meta({
    description:
      'Tool-step output mappings over `result`. Each value is exactly one $' + '{{ }} expression.',
  });

// `outputs` carries the declaration form on run, agent, and checkout steps and
// the expression mapping form on tool steps. One value union accepts both so
// the step `superRefine` can report the form expected by the selected kind;
// zod reports the declaration branch's own issues for malformed declarations.
export const workflowDocumentStepExportSchema = z.union([
  z.literal(true),
  z.array(z.string().min(1)).min(1),
]);

const workflowDocumentStepOutputValueSchema = z.union([
  workflowDocumentStepOutputDeclarationSchema,
  workflowDocumentToolStepOutputMappingValueSchema,
]);

const workflowDocumentStepOutputsFieldSchema = z
  .record(z.string(), workflowDocumentStepOutputValueSchema)
  .superRefine((outputs, ctx) => stepOutputsRecordChecks(outputs, ctx));

export const workflowDocumentConcurrencySchema = z
  .strictObject({
    group: z.string().min(1).meta({
      description:
        'Names the group. Runs with the same group name wait for each other. Supports workflow expressions. See [Contexts](/reference/contexts#context-availability).',
    }),
    scope: z.enum(['workflow', 'project']).optional().meta({
      description:
        'Chooses whether the group applies to this workflow or every workflow in the project.',
    }),
    cancel_in_progress: z.boolean().optional().meta({
      description: 'Set to `true` to stop the active run when a newer run joins the group.',
    }),
  })
  .meta({
    description:
      'Limits each group to one active run and the newest waiting run. See [Workflow concurrency groups](/understand/workflow-concurrency-groups).',
  });

const workflowDocumentTriggerBaseSchema = {
  source: z.string().min(1).meta({
    description:
      'Selects the slug of an integration connection or a built-in source that starts the workflow. See [Integrations](/integrations) for provider sources.',
  }),
  with: z.record(z.string(), z.unknown()).optional().meta({
    description:
      "Provides values that match or configure the trigger. See each provider's event catalog in [Integrations](/integrations).",
  }),
  secrets: z.record(z.string(), z.string()).optional().meta({
    description: 'Maps trigger input names to secret names in the Shipfox project.',
  }),
  filter: z.string().min(1).optional().meta({
    description:
      'Starts the workflow only when an event matches this condition. The condition can use `event` and `trigger`. `manual` and `cron` triggers do not use this field. See [Expressions](/reference/expressions) and [Contexts](/reference/contexts#context-availability).',
  }),
  config: z.record(z.string(), z.unknown()).optional().meta({
    description:
      'Configures a built-in trigger source, such as `cron`. See [Schedule workflows](/how-to/author-workflows/schedule-workflows).',
  }),
} satisfies z.ZodRawShape;

export const triggerSourceConfigSchemas = {
  cron: z.strictObject({
    schedule: z.string().min(1).optional().meta({
      description: 'Cron expression that schedules the workflow.',
    }),
    timezone: z.string().min(1).optional().meta({
      description: 'IANA time zone used to evaluate `schedule`.',
    }),
  }),
} satisfies Record<string, z.ZodType>;
const triggerSourceConfigSchemaRegistry: Readonly<Record<string, z.ZodType>> =
  triggerSourceConfigSchemas;

export const workflowDocumentTriggerSchema = z
  .strictObject({
    ...workflowDocumentTriggerBaseSchema,
    event: z.string().min(1).optional().meta({
      description:
        'Selects the event that starts the workflow. Omit it to accept every event from the source.',
    }),
  })
  .superRefine((trigger, ctx) => {
    if (trigger.config === undefined) return;

    const configSchema = triggerSourceConfigSchemaRegistry[trigger.source];
    if (configSchema === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['config'],
        message: `\`config\` is not supported for source \`${trigger.source}\`.`,
      });
      return;
    }

    const configResult = configSchema.safeParse(trigger.config);
    if (configResult.success) return;

    for (const configIssue of configResult.error.issues) {
      ctx.addIssue({
        ...configIssue,
        path: ['config', ...configIssue.path],
      });
    }
  });

const workflowDocumentListeningSchema = z
  .strictObject({
    on: z.array(workflowDocumentTriggerSchema).min(1).meta({
      description: 'Selects the events to listen for.',
    }),
    until: z.array(workflowDocumentTriggerSchema).min(1).optional().meta({
      description: 'Stops listening when one of these events arrives.',
    }),
    timeout: z.string().min(1).optional().meta({
      description: 'Stops listening after this duration.',
    }),
    max_executions: z.number().int().positive().optional().meta({
      description: 'Stops listening after this many job executions.',
    }),
    batch: z
      .strictObject({
        debounce: z.string().min(1).optional().meta({
          description: 'Waits for this quiet period before processing a batch.',
        }),
        max_size: z.number().int().positive().optional().meta({
          description: 'Limits each batch to this number of events.',
        }),
        max_wait: z.string().min(1).optional().meta({
          description: 'Processes a partial batch after this duration.',
        }),
      })
      .refine(
        (value) =>
          value.debounce !== undefined ||
          value.max_size !== undefined ||
          value.max_wait !== undefined,
        {message: 'Expected debounce, max_size, or max_wait'},
      )
      .optional()
      .meta({
        description:
          'Groups matching events before the job processes them. Set `debounce`, `max_size`, or `max_wait`.',
      }),
    on_resolve: z.enum(['finish', 'cancel']).optional().meta({
      description:
        'Chooses what Shipfox does when listening ends. `finish` lets the current execution finish. `cancel` stops it.',
    }),
  })
  .superRefine((listening, ctx) => {
    for (const field of ['on', 'until'] as const) {
      for (const [index, trigger] of (listening[field] ?? []).entries()) {
        if (trigger.config !== undefined) {
          ctx.addIssue({
            code: 'custom',
            path: [field, index, 'config'],
            message: '`config` is only supported on top-level triggers.',
          });
        }
      }
    }
  });

const workflowGateMaxAttemptsError = 'Expected a positive integer no greater than 1000.';
const workflowGateMaxAttemptsSchema = z
  .number({error: workflowGateMaxAttemptsError})
  .int({message: workflowGateMaxAttemptsError})
  .min(1, {message: workflowGateMaxAttemptsError})
  .max(WORKFLOW_GATE_MAX_ATTEMPTS_MAX, {message: workflowGateMaxAttemptsError})
  .optional()
  .meta({
    description:
      'Maximum number of executions of the gating step, including the first execution. Accepts integers from 1 through 1,000. Omit to use five attempts. There is no `unlimited` value.',
  });

const workflowDocumentGateFailureRuleSchema = z.strictObject({
  if: z.string().min(1).optional().meta({
    description:
      'Selects this rule when the condition returns `true`. A rule with no `if` always applies, so only the last rule can omit it. The condition reads the same context as `success`, including `step.outputs`. Use `has()` before you read an output the step may not set. When no rule applies, the job fails with the error of the step.',
  }),
  restart_from: z.string().min(1).meta({
    description: 'Selects the earlier step where the job restarts after the gate fails.',
  }),
  feedback: z.string().min(1).optional().meta({
    description:
      'Provides text that the repeated step can read after the gate fails. Supports workflow expressions.',
  }),
  max_attempts: workflowGateMaxAttemptsSchema,
});

const workflowDocumentGateFailureRuleJsonSchema = z.toJSONSchema(
  workflowDocumentGateFailureRuleSchema,
  {io: 'input', unrepresentable: 'any'},
);
delete (workflowDocumentGateFailureRuleJsonSchema as {$schema?: string}).$schema;

// A union would report any rule error as one `invalid_union` issue at `on_failure`.
// Dispatching on the array shape keeps each rule error at the field that caused it.
const workflowDocumentGateFailureSchema = z
  .unknown()
  .superRefine((value, ctx) => {
    const isList = Array.isArray(value);
    if (isList && value.length === 0) {
      ctx.addIssue({
        code: 'too_small',
        origin: 'array',
        minimum: 1,
        inclusive: true,
        input: value,
        message: 'Too small: expected array to have >=1 items',
      });
      return;
    }
    for (const [index, rule] of (isList ? value : [value]).entries()) {
      const result = workflowDocumentGateFailureRuleSchema.safeParse(rule);
      if (result.success) continue;
      for (const issue of result.error.issues) {
        ctx.addIssue({...issue, path: isList ? [index, ...issue.path] : issue.path});
      }
    }
  })
  .meta({
    description:
      'Restarts the job from an earlier step when the gate fails. Give one rule, or a list of rules where the first rule that applies restarts the job. See [Feedback loops](/understand/feedback-loops).',
    anyOf: [
      workflowDocumentGateFailureRuleJsonSchema,
      {type: 'array', minItems: 1, items: workflowDocumentGateFailureRuleJsonSchema},
    ],
  }) as unknown as z.ZodType<
  | z.infer<typeof workflowDocumentGateFailureRuleSchema>
  | z.infer<typeof workflowDocumentGateFailureRuleSchema>[]
>;

const workflowDocumentStepGateSchema = z
  .strictObject({
    success: z.string().min(1).optional().meta({
      description:
        'Marks the step as successful when the condition returns `true`. See [Check and restart are separate](/understand/feedback-loops#check-and-restart-are-separate).',
    }),
    on_failure: workflowDocumentGateFailureSchema.optional(),
  })
  .refine((value) => value.success !== undefined || value.on_failure !== undefined, {
    message: 'Expected success or on_failure',
  });

const workflowDocumentCheckoutPermissionsSchema = z
  .strictObject({
    contents: z.enum(['read', 'write']).optional().meta({
      description: 'Sets read or write access to the repository contents.',
    }),
  })
  .optional()
  .meta({
    description: 'Sets the repository permissions for this checkout.',
  });

const workflowDocumentPersistCredentialsSchema = z.boolean().optional().meta({
  description: 'Keeps checkout credentials available to later run steps.',
});

export const workflowDocumentCheckoutSchema = z
  .strictObject({
    project: z.string().min(1).optional().meta({
      description:
        'Checks out the repository from this Shipfox project. Do not use it with `connection` or `repository`.',
    }),
    connection: z.string().min(1).optional().meta({
      description:
        'Selects the integration connection that can access the repository. Use it with `repository`.',
    }),
    repository: z.string().min(1).optional().meta({
      description: 'Names the repository to check out. Use `owner/name` or a bare repository name.',
    }),
    ref: z.string().min(1).optional().meta({
      description: 'Selects the branch, tag, or commit to check out.',
    }),
    'fetch-depth': z.number().int().min(0).optional().meta({
      description: 'Sets how many commits to fetch. Use `0` for the full history.',
    }),
    path: z.string().min(1).optional().meta({
      description:
        'Sets the destination folder under the job root. Required unless this checkout owns the job root.',
    }),
    permissions: workflowDocumentCheckoutPermissionsSchema,
    'persist-credentials': workflowDocumentPersistCredentialsSchema,
    force: z.boolean().optional().meta({
      description: 'Allows checkout to replace existing content at the destination.',
    }),
  })
  .superRefine((checkout, ctx) => {
    for (const validationIssue of checkoutTargetValidationIssues(checkout)) {
      let message = '"connection" requires "repository".';
      if (validationIssue.kind === 'project-with-connection') {
        message = '"connection" cannot be combined with "project".';
      } else if (validationIssue.kind === 'project-with-repository') {
        message = '"repository" cannot be combined with "project".';
      }
      ctx.addIssue({
        code: 'custom',
        path: [validationIssue.path],
        message,
      });
    }
  });

const workflowDocumentJobCheckoutSchema = z
  .union([
    z.strictObject({
      permissions: workflowDocumentCheckoutPermissionsSchema,
      'persist-credentials': workflowDocumentPersistCredentialsSchema,
    }),
    z.literal(false),
  ])
  .meta({
    description:
      'Configures repository permissions and saved credentials for the project checkout at the job root. Set to `false` to skip that checkout.',
  });

export const workflowDocumentStepIntegrationSelectionSchema = z.array(z.string().min(1)).min(1);

export const workflowDocumentStepIntegrationSchema = z.strictObject({
  connection: z.string().min(1).optional().meta({
    description: 'Selects an integration connection by its slug.',
  }),
  include: workflowDocumentStepIntegrationSelectionSchema.meta({
    description:
      "Selects tools for the agent. See [Integrations](/integrations) for each provider's selectors.",
  }),
  exclude: workflowDocumentStepIntegrationSelectionSchema.optional().meta({
    description: 'Removes tools from the `include` selection.',
  }),
  allow_write: z.boolean().optional().meta({
    description:
      'Set to `true` to let the agent use tools that can change external data. Otherwise, the agent receives read-only tools.',
  }),
});

// The agent sees each tool as `<name>__<tool>`, so a name has single underscores only.
export const WORKFLOW_AGENT_MCP_SERVER_NAME_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
export const WORKFLOW_AGENT_MCP_SERVER_NAME_MAX_LENGTH = 20;

const agentMcpServerLiteralSchema = (message: string) =>
  z.string().regex(WORKFLOW_LITERAL_NAME_PATTERN, {message});

// HTTP field names (RFC 9110 tokens).
const agentMcpServerHeaderNameSchema = z.string().refine(isHttpFieldName, {
  message: 'MCP server header names must be HTTP field names.',
});

const HEADER_VALUE_DISALLOWED_CHARACTER_RE = /[\r\n\0]/;

const agentMcpServerHeaderValueSchema = z.union([
  z.string().refine((value) => !HEADER_VALUE_DISALLOWED_CHARACTER_RE.test(value), {
    message: 'MCP server header values cannot contain line breaks or null bytes.',
  }),
  z.number(),
  z.boolean(),
]);

// The runner's MCP client sets these for the transport, so a user value would break it.
const AGENT_MCP_SERVER_RESERVED_HEADERS = new Set([
  'accept',
  'content-length',
  'content-type',
  'host',
  'last-event-id',
  'mcp-protocol-version',
  'mcp-session-id',
]);

const agentMcpServerHeadersSchema = z
  .record(agentMcpServerHeaderNameSchema, agentMcpServerHeaderValueSchema)
  .superRefine(boundedRecordChecks('Headers'))
  .superRefine((headers, ctx) => {
    const seen = new Set<string>();
    for (const name of Object.keys(headers)) {
      const key = name.toLowerCase();
      if (AGENT_MCP_SERVER_RESERVED_HEADERS.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: [name],
          message: `MCP server header "${name}" is set by the runner.`,
        });
      } else if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: [name],
          message: `MCP server header "${name}" repeats another header name in a different case.`,
        });
      }
      seen.add(key);
    }
  });

const agentMcpServerUrlSchema = agentMcpServerLiteralSchema(
  'MCP server url must be literal.',
).refine(
  (value) => {
    try {
      const {protocol} = new URL(value);
      return protocol === 'http:' || protocol === 'https:';
    } catch {
      return false;
    }
  },
  {message: 'MCP server url must be an http or https URL.'},
);

const AGENT_MCP_SERVER_STDIO_FIELDS = ['args', 'env'] as const;

// `command`, `args`, and `url` stay literal so secrets never reach argv or the server address;
// dynamic values go through `env` or `headers`. One object with a refinement, not a union, keeps
// each error on its own field.
export const workflowDocumentAgentMcpServerSchema = z
  .strictObject({
    command: agentMcpServerLiteralSchema(
      'MCP server command must be literal. Use "env" for values.',
    )
      .min(1)
      .optional()
      .meta({
        description:
          'Names the program that starts the server. It runs without a shell. Set `command` or `url`, not both.',
      }),
    args: z
      .array(agentMcpServerLiteralSchema('MCP server args must be literal. Use "env" for values.'))
      .optional()
      .meta({
        description:
          'Passes these arguments to `command`. Workflow expressions are not allowed; use `env` for values.',
      }),
    env: workflowDocumentEnvSchema.optional().meta({
      description:
        'Sets environment variables for the `command` server. Values support workflow expressions, including `secrets`.',
    }),
    url: agentMcpServerUrlSchema.optional().meta({
      description:
        'Connects to a server that you run, over Streamable HTTP. An `http` or `https` URL that the runner can reach. Set `command` or `url`, not both.',
    }),
    headers: agentMcpServerHeadersSchema.optional().meta({
      description:
        'Sends these HTTP headers to the `url` server with every request. Values support workflow expressions, including `secrets`.',
    }),
    include: z
      .array(agentMcpServerLiteralSchema('MCP server tool names must be literal.').min(1))
      .min(1)
      .optional()
      .meta({
        description:
          'Lists the tools to give the agent, named as the server lists them. Defaults to every tool.',
      }),
  })
  .superRefine((server, ctx) => {
    if ((server.command === undefined) === (server.url === undefined)) {
      ctx.addIssue({
        code: 'custom',
        message: 'An MCP server sets exactly one of "command" or "url".',
      });
      return;
    }
    if (server.url !== undefined) {
      for (const field of AGENT_MCP_SERVER_STDIO_FIELDS) {
        if (server[field] === undefined) continue;
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: `"${field}" applies to "command" servers. Use "headers" for a "url" server.`,
        });
      }
    } else if (server.headers !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['headers'],
        message: '"headers" applies to "url" servers. Use "env" for a "command" server.',
      });
    }
  });

export const workflowDocumentAgentMcpServersSchema = z
  .record(
    z
      .string()
      .max(WORKFLOW_AGENT_MCP_SERVER_NAME_MAX_LENGTH, {
        message: `MCP server names can have at most ${WORKFLOW_AGENT_MCP_SERVER_NAME_MAX_LENGTH} characters.`,
      })
      .regex(WORKFLOW_AGENT_MCP_SERVER_NAME_PATTERN, {
        message:
          'MCP server names must start with a lowercase letter and contain only lowercase letters, numbers, and single underscores.',
      }),
    workflowDocumentAgentMcpServerSchema,
  )
  .refine((servers) => Object.keys(servers).length > 0, {
    message: 'Define at least one MCP server.',
  })
  .meta({
    description:
      'Gives the agent the tools of these MCP servers as `<name>__<tool>`. The runner starts each `command` server for the step and connects to each `url` server. Each key is a server name: a lowercase letter, then lowercase letters, numbers, and single underscores, with at most 20 characters. See [Use your own MCP server](/how-to/author-workflows/use-your-own-mcp-server).',
  });

// A session names an agent conversation that continues across steps of one run.
// The shorthand string form names the session and resumes it; the long form
// adds an explicit mode. The key is a field template, evaluated at step
// dispatch with the same context roots the prompt sees.
const workflowSessionKeyLiteralSchema = z
  .string()
  .min(1)
  .max(WORKFLOW_SESSION_KEY_MAX_LENGTH)
  .regex(WORKFLOW_SESSION_KEY_PATTERN, {
    message:
      'Literal session keys must start with a letter or number and contain only letters, numbers, dots, underscores, or hyphens.',
  });
const workflowSessionKeyTemplateSchema = z
  .string()
  .min(1)
  .regex(WORKFLOW_INTERPOLATED_VALUE_PATTERN, {
    message: 'Session keys with interpolation must use a $' + '{{ }} template.',
  })
  .refine(isValidWorkflowSessionKeyTemplateLiteralParts, {
    message:
      'Literal parts of interpolated session keys may contain only letters, numbers, dots, underscores, or hyphens, and may not exceed 128 characters in total.',
  });
const workflowSessionKeySchema = z.union([
  workflowSessionKeyLiteralSchema,
  workflowSessionKeyTemplateSchema,
]);

export const workflowDocumentSessionSchema = z
  .union([
    workflowSessionKeyLiteralSchema,
    workflowSessionKeyTemplateSchema,
    z.strictObject({
      key: workflowSessionKeySchema.meta({
        description: 'Names the session. Supports a $' + '{{ }} expression.',
      }),
      mode: z.enum(['resume', 'fork']).optional().meta({
        description:
          'Chooses how to continue the session. `resume` continues and updates it. `fork` reads a snapshot without updating it.',
      }),
    }),
  ])
  .meta({
    description:
      'Continues an agent conversation across steps in one workflow run. See [Agent sessions](/understand/agent-sessions).',
  });

// Repository context controls which repository files the agent reads. Each toggle is a boolean
// or a template that resolves to one when the step is dispatched, so a workflow can turn the
// context off for untrusted refs.
const workflowRepositoryContextToggleSchema = z.union([
  z.boolean(),
  z.string().regex(WORKFLOW_INTERPOLATED_VALUE_PATTERN, {
    message: 'Repository context must be `true`, `false`, or a $' + '{{ }} expression.',
  }),
]);

export const workflowDocumentRepositoryContextSchema = z
  .union([
    workflowRepositoryContextToggleSchema,
    z.strictObject({
      instructions: workflowRepositoryContextToggleSchema.optional().meta({
        description:
          'Reads `AGENTS.md` or `CLAUDE.md` from the repository root down to the working directory. Supports a $' +
          '{{ }} expression.',
      }),
      skills: z
        .union([
          workflowRepositoryContextToggleSchema,
          z
            .array(literalNameSchema('Skill names must be literal. Interpolation is rejected.'))
            .min(1),
        ])
        .optional()
        .meta({
          description:
            'Loads skills from `.agents/skills` and `.claude/skills`. Use `true`, `false`, a $' +
            '{{ }} expression, or a list of skill names.',
        }),
    }),
  ])
  .meta({
    description:
      'Controls the repository instructions and skills that the agent reads. Set to `false` to turn both off, or set `instructions` and `skills` separately. See [Coding agents](/reference/coding-agents).',
  });

export function isValidWorkflowSessionKeyTemplateLiteralParts(source: string): boolean {
  let cursor = 0;
  let expressionSeen = false;
  let literalLength = 0;

  while (true) {
    const opener = source.indexOf('${{', cursor);
    const literalEnd = opener === -1 ? source.length : opener;
    const literal = source.slice(cursor, literalEnd);
    literalLength += literal.length;

    if (
      literalLength > WORKFLOW_SESSION_KEY_MAX_LENGTH ||
      !workflowSessionKeyLiteralPartPattern.test(literal) ||
      (!expressionSeen &&
        literal.length > 0 &&
        !workflowSessionKeyLiteralPartStartPattern.test(literal))
    ) {
      return false;
    }

    if (opener === -1) return expressionSeen;

    const close = findWorkflowSessionKeyTemplateClose(source, opener);
    if (close === -1) return false;

    expressionSeen = true;
    cursor = close + 2;
  }
}

function findWorkflowSessionKeyTemplateClose(source: string, openerIndex: number): number {
  let index = openerIndex + 3;
  let depth = 0;

  while (index < source.length) {
    const stringEnd = scanWorkflowSessionKeyStringLiteral(source, index);
    if (stringEnd !== null) {
      index = stringEnd;
      continue;
    }

    const commentEnd = workflowSessionKeyCommentEnd(source, index);
    if (commentEnd !== undefined) {
      index = commentEnd;
      continue;
    }

    if (depth === 0 && source.startsWith('}}', index)) return index;

    depth = workflowSessionKeyDepthAfterCharacter(source[index], depth);

    index += 1;
  }

  return -1;
}

function workflowSessionKeyCommentEnd(source: string, index: number): number | undefined {
  if (!source.startsWith('//', index)) return undefined;
  const newline = source.indexOf('\n', index + 2);
  return newline === -1 ? source.length : newline;
}

function workflowSessionKeyDepthAfterCharacter(
  character: string | undefined,
  depth: number,
): number {
  if (character === '(' || character === '[' || character === '{') return depth + 1;
  if ((character === ')' || character === ']' || character === '}') && depth > 0) return depth - 1;
  return depth;
}

function scanWorkflowSessionKeyStringLiteral(source: string, index: number): number | null {
  for (const prefix of ['r', 'R', 'b', 'B', ''] as const) {
    if (!source.startsWith(prefix, index)) continue;

    const quoteIndex = index + prefix.length;
    const quote = source[quoteIndex];
    if (quote !== '"' && quote !== "'") continue;

    const tripleQuote = quote.repeat(3);
    if (source.startsWith(tripleQuote, quoteIndex)) {
      return scanWorkflowSessionKeyQuotedString(
        source,
        quoteIndex + 3,
        tripleQuote,
        prefix === 'r' || prefix === 'R',
      );
    }

    return scanWorkflowSessionKeyQuotedString(
      source,
      quoteIndex + 1,
      quote,
      prefix === 'r' || prefix === 'R',
    );
  }

  return null;
}

function scanWorkflowSessionKeyQuotedString(
  source: string,
  startIndex: number,
  delimiter: string,
  raw: boolean,
): number {
  let index = startIndex;
  while (index < source.length) {
    if (!raw && source[index] === '\\') {
      index += 2;
      continue;
    }

    if (source.startsWith(delimiter, index)) return index + delimiter.length;

    index += 1;
  }

  return source.length;
}

export const workflowDocumentAgentStepFields = [
  'model',
  'prompt',
  'harness',
  'thinking',
  'provider',
  'tools',
  'tool_surface',
  'integrations',
  'mcp_servers',
  'session',
  'repository_context',
] as const;

const runAfterSchema = z.enum(['success', 'failure', 'always']);

// A step is a run step (`run`), an inline agent step (`prompt`), a checkout step
// (`checkout`), a tool step (`tool`), or an action step (`uses`), never two
// kinds at once. They share one strict object so an unknown key is still
// rejected; the `superRefine` discriminates by which payload keys are present
// and emits one targeted issue per offending field (a plain union would surface
// every branch's errors at once). The `agent` keyword is declared only so the reserved-keyword case
// produces a clear message instead of a generic "unrecognized key".
/**
 * `composite` parses the steps of a composite action: `uses:` and prompt
 * `file:` accept a `${{ action.path }}/` prefix, and the step kind rules
 * differ (see `validateCompositeStep`).
 */
type WorkflowDocumentStepMode = 'workflow' | 'composite';

const workflowDocumentControlTargetsSchema = z.union([
  z.string().min(1),
  z.array(z.string().min(1)).min(1),
]);

const workflowDocumentStepBaseSchema = z.strictObject({
  key: z
    .string()
    .min(1)
    .optional()
    .meta({description: 'Gives the step an identifier that other fields can use.'}),
  if: z.string().min(1).optional().meta({
    description:
      'Runs this step only when the condition is true. See [Conditionals](/reference/expressions#syntax).',
  }),
  run_after: runAfterSchema.optional().meta({
    description:
      'Picks when this step runs relative to earlier steps in the job: `success` (default) skips it after a failed step, `failure` runs it only after a failed step, `always` runs it either way. The `if` is checked after `run_after` passes.',
  }),
  continue_on_error: z.boolean().optional().meta({
    description:
      'Lets the job go on as if this step succeeded when it fails. The step still ends `failed`, but its failure does not count for `run_after` or for the job result. Gate restarts run first. It does not cover a step that cannot start or a job that times out.',
  }),
  background: z.boolean().optional().meta({
    description:
      'Starts the step and moves on to the next step without waiting. The step needs a `key`. Later steps read its results after a `wait` that joins it.',
  }),
  wait: workflowDocumentControlTargetsSchema.optional().meta({
    description:
      'Blocks until the listed background steps finish. Give one step `key` or a list. A wait step accepts only `name`.',
  }),
  wait_all: z
    .union([z.null(), z.literal(true)])
    .optional()
    .meta({
      description:
        'Blocks until every background step that is still running finishes. Write `wait_all:` or `wait_all: true`. A wait step accepts only `name`.',
    }),
  cancel: workflowDocumentControlTargetsSchema.optional().meta({
    description:
      'Stops the listed background steps without waiting for them to finish. Give one step `key` or a list. A cancel step accepts only `name`.',
  }),
  name: z.string().min(1).optional().meta({description: 'Sets the name shown for the step.'}),
  working_directory: z.string().min(1).optional().meta({
    description:
      'Sets the folder where the command runs. The path is relative to the job workspace.',
  }),
  run: z.string().min(1).optional().meta({
    description:
      'Runs a shell command. Pass workflow values as command arguments, such as `deploy "$TARGET"`. Do not send them to commands such as `eval` or `sh -c`.',
  }),
  checkout: workflowDocumentCheckoutSchema.optional().meta({
    description:
      'Checks out a repository for this step. Set a non-root `path` to keep the project checkout at the job root.',
  }),
  model: z.string().min(1).optional().meta({
    description: 'Selects the model that the agent uses.',
  }),
  prompt: promptSchema('workflow').optional().meta({
    description:
      'Gives the agent its instructions. Use a string, or a list of parts that Shipfox joins with a blank line. A part is a string or a `file` reference.',
  }),
  harness: harnessSchema.optional().meta({
    description:
      'Selects the agent runtime. Shipfox uses the workspace default harness, or `pi` if no default exists. See [Agent harness](/reference/glossary#agent-harness).',
  }),
  thinking: agentThinkingFieldSchema.optional(),
  session: workflowDocumentSessionSchema.optional(),
  repository_context: workflowDocumentRepositoryContextSchema.optional(),
  provider: z.string().min(1).optional().meta({
    description:
      'Selects the model provider for this step. See [Model providers](/reference/model-providers).',
  }),
  tools: z.array(z.string().min(1)).min(1).optional().meta({
    description: 'Gives the agent the listed built-in tools.',
  }),
  tool_surface: agentToolSurfaceSchema.optional(),
  integrations: z.array(workflowDocumentStepIntegrationSchema).min(1).optional().meta({
    description:
      'Adds tools from integration connections to this agent step. See [integrations and tools](/understand/integrations-connections-and-tools).',
  }),
  mcp_servers: workflowDocumentAgentMcpServersSchema.optional(),
  agent: z.unknown().optional().meta({
    description: 'Reserved keyword. It is rejected; use `prompt` to define an agent step.',
  }),
  tool: literalNameSchema('Tool id must be literal. Interpolation is rejected.').optional().meta({
    description:
      'Calls an integration tool by its id. Use a standalone tool or a family method such as `family.method`. See [Call an integration tool](/how-to/author-workflows/call-integration-tool) for an example.',
  }),
  connection: literalNameSchema('Connection slug must be literal. Interpolation is rejected.')
    .optional()
    .meta({
      description:
        'Selects an integration connection by its slug. If omitted, Shipfox uses the source integration connection of the project.',
    }),
  uses: literalNameSchema('Action path must be literal. Interpolation is rejected.')
    .optional()
    .meta({
      description:
        'Runs the action in this repository directory. The path starts with `./` and the directory contains an `action.yml` manifest.',
    }),
  connections: z
    .record(
      workflowDocumentActionAliasSchema,
      literalNameSchema('Connection slug must be literal. Interpolation is rejected.'),
    )
    .optional()
    .meta({
      description:
        'Binds each integration alias declared in the action manifest to a connection slug.',
    }),
  with: workflowDocumentStepWithSchema.optional(),
  gate: workflowDocumentStepGateSchema.optional().meta({
    description:
      'Checks the step result and can restart earlier steps. Set `success`, `on_failure`, or both. See [Feedback loops](/understand/feedback-loops).',
  }),
  env: workflowDocumentEnvSchema.optional().meta({
    description: 'Sets environment variables for this run step.',
  }),
  outputs: workflowDocumentStepOutputsFieldSchema.optional().meta({
    description: 'Defines values that later steps can use.',
  }),
  export: workflowDocumentStepExportSchema.optional().meta({
    description:
      'Promotes outputs of this step to job outputs of the same name. Use `true` for every declared output, or list the output names. The step needs a `key`. Checkout steps do not support it.',
  }),
});

type WorkflowDocumentStepSchemaFields = Omit<
  z.infer<typeof workflowDocumentStepBaseSchema>,
  'outputs' | 'tool'
>;
type WorkflowDocumentStepSchemaOutput =
  | (WorkflowDocumentStepSchemaFields & {
      tool: string;
      outputs?: WorkflowDocumentToolStepOutputs;
    })
  | (WorkflowDocumentStepSchemaFields & {
      tool?: undefined;
      outputs?: WorkflowDocumentStepOutputs;
    });
type WorkflowDocumentStepInput = z.infer<typeof workflowDocumentStepBaseSchema>;

const workflowDocumentActionStepFields = ['uses', 'connections'] as const;
// A wait or cancel step is its own kind: it accepts only `name`, so no other
// kind may carry its keys.
export const workflowDocumentControlStepFields = ['wait', 'wait_all', 'cancel'] as const;

export const workflowDocumentStepKindInvalidFields = {
  run: [
    ...workflowDocumentAgentStepFields,
    ...workflowDocumentActionStepFields,
    ...workflowDocumentControlStepFields,
    'checkout',
    'tool',
    'connection',
    'with',
  ],
  agent: [
    'run',
    ...workflowDocumentActionStepFields,
    ...workflowDocumentControlStepFields,
    'checkout',
    'tool',
    'connection',
    'with',
  ],
  checkout: [
    'run',
    ...workflowDocumentAgentStepFields,
    ...workflowDocumentActionStepFields,
    ...workflowDocumentControlStepFields,
    'background',
    'env',
    'export',
    'tool',
    'connection',
    'with',
  ],
  tool: [
    'run',
    ...workflowDocumentAgentStepFields,
    ...workflowDocumentActionStepFields,
    ...workflowDocumentControlStepFields,
    'checkout',
    'env',
    'working_directory',
  ],
  action: [
    'run',
    ...workflowDocumentAgentStepFields,
    ...workflowDocumentControlStepFields,
    'checkout',
    'tool',
    'connection',
    'outputs',
  ],
} as const;

type WorkflowDocumentStepKind = keyof typeof workflowDocumentStepKindInvalidFields;

function toStepSchemaOutput({
  outputs,
  ...step
}: WorkflowDocumentStepInput): WorkflowDocumentStepSchemaOutput {
  return {
    ...step,
    ...(outputs === undefined
      ? {}
      : {
          outputs:
            step.tool === undefined
              ? (outputs as WorkflowDocumentStepOutputs)
              : (outputs as WorkflowDocumentToolStepOutputs),
        }),
  } as WorkflowDocumentStepSchemaOutput;
}

export const workflowDocumentStepSchema = workflowDocumentStepBaseSchema
  .superRefine(validateWorkflowDocumentStep)
  .transform<WorkflowDocumentStepSchemaOutput>(toStepSchemaOutput);

const compositeUsesSchema = z
  .string()
  .min(1)
  .superRefine((uses, ctx) => {
    const message = compositeUsesIssue(uses);
    if (message !== undefined) ctx.addIssue({code: 'custom', message});
  })
  .meta({
    description: `Runs an action. Use a repository path that starts with \`./\`, a path inside this action that starts with \`${WORKFLOW_ACTION_PATH_PREFIX}\`, or a registry reference.`,
  });

function compositeUsesIssue(uses: string): string | undefined {
  const relativePath = actionPathRelativePart(uses);
  if (relativePath !== undefined) return actionPathRelativePartIssue(relativePath);
  if (WORKFLOW_LITERAL_NAME_PATTERN.test(uses)) return undefined;
  return `Action path must be literal. Interpolation is rejected, except a leading \`${WORKFLOW_ACTION_PATH_PREFIX}\`.`;
}

/**
 * A step of a composite action (`steps:` in `action.yml`). It has the shape
 * of a job step, without `checkout` and `export`, and a tool step must name
 * an integration alias in `connection`.
 */
export const workflowDocumentCompositeStepSchema = workflowDocumentStepBaseSchema
  .extend({
    prompt: promptSchema('composite').optional().meta({
      description:
        'Gives the agent its instructions. Use a string, or a list of parts that Shipfox joins with a blank line. A part is a string or a `file` reference.',
    }),
    uses: compositeUsesSchema.optional(),
  })
  .superRefine((step, ctx) => {
    validateWorkflowDocumentStep(step, ctx);
    validateCompositeStep(step, ctx);
  })
  .transform<WorkflowDocumentStepSchemaOutput>(toStepSchemaOutput);

function validateCompositeStep(step: WorkflowDocumentStepInput, ctx: z.RefinementCtx): void {
  for (const field of ['background', ...workflowDocumentControlStepFields] as const) {
    if (step[field] === undefined) continue;
    ctx.addIssue({
      code: 'custom',
      path: [field],
      message: `\`${field}\` is not supported inside a composite action.`,
    });
  }
  if (step.checkout !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['checkout'],
      message: 'A composite action cannot check out a repository. The job owns its checkout.',
    });
  }
  if (step.export !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['export'],
      message:
        '`export` is not valid inside a composite action. Set `export` on the step that uses the action.',
    });
  }
  if (step.tool !== undefined && step.connection === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['connection'],
      message:
        'A tool step inside a composite action needs `connection`, set to an integration alias of the action.',
    });
  }
}

function validateWorkflowDocumentStep(step: WorkflowDocumentStepInput, ctx: z.RefinementCtx): void {
  if (validateWorkflowDocumentControlStep(step, ctx)) return;
  validateWorkflowDocumentStepExport(step, ctx);
  if (step.agent !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['agent'],
      message: 'The "agent" keyword is reserved for a future step kind and is not supported yet.',
    });
    return;
  }
  if (step.uses !== undefined) {
    validateWorkflowDocumentActionStep(step, ctx);
    return;
  }
  if (step.checkout !== undefined) {
    validateWorkflowDocumentStepOutputs(step, ctx, 'checkout');
    validateWorkflowDocumentCheckoutStep(step, ctx);
    return;
  }
  if (step.tool !== undefined) {
    validateWorkflowDocumentStepOutputs(step, ctx, 'tool');
    validateWorkflowDocumentToolStep(step, ctx);
    return;
  }
  if (step.run !== undefined) {
    validateWorkflowDocumentStepOutputs(step, ctx, 'run');
    validateWorkflowDocumentRunStep(step, ctx);
    return;
  }
  validateWorkflowDocumentStepOutputs(step, ctx, 'agent');
  validateWorkflowDocumentAgentStep(step, ctx);
}

const workflowDocumentStepFieldNames = Object.keys(
  workflowDocumentStepBaseSchema.shape,
) as (keyof WorkflowDocumentStepInput)[];

/**
 * A `wait`, `wait_all`, or `cancel` step runs no work of its own. It accepts
 * its one control key and `name`, and nothing else. Returns whether the step is
 * a control step, so the caller skips the rules of the other kinds.
 */
function validateWorkflowDocumentControlStep(
  step: WorkflowDocumentStepInput,
  ctx: z.RefinementCtx,
): boolean {
  const present = workflowDocumentControlStepFields.filter((field) => step[field] !== undefined);
  const [first] = present;
  if (first === undefined) return false;
  for (const field of present.slice(1)) {
    ctx.addIssue({
      code: 'custom',
      path: [field],
      message: `"${field}" cannot be combined with "${first}" in one step.`,
    });
  }
  const label = first === 'cancel' ? 'cancel' : 'wait';
  for (const key of workflowDocumentStepFieldNames) {
    if (key === 'name' || step[key] === undefined) continue;
    if ((workflowDocumentControlStepFields as readonly string[]).includes(key)) continue;
    ctx.addIssue({
      code: 'custom',
      path: [key],
      message: `"${key}" is not valid on a ${label} step. A ${label} step accepts only "name".`,
    });
  }
  return true;
}

function validateWorkflowDocumentStepExport(
  step: WorkflowDocumentStepInput,
  ctx: z.RefinementCtx,
): void {
  if (step.export === undefined) return;
  if (step.key === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['export'],
      message: 'A step that sets "export" requires a "key".',
    });
  }
  if (step.export === true) return;
  const seen = new Set<string>();
  for (const [index, name] of step.export.entries()) {
    if (seen.has(name)) {
      ctx.addIssue({
        code: 'custom',
        path: ['export', index],
        message: `Output "${name}" is listed more than once in "export".`,
      });
    }
    seen.add(name);
  }
}

function validateWorkflowDocumentStepOutputs(
  step: WorkflowDocumentStepInput,
  ctx: z.RefinementCtx,
  stepKind: 'agent' | 'checkout' | 'run' | 'tool',
): void {
  if (step.outputs === undefined) return;
  if (Object.keys(step.outputs).length === 0) return;
  const isMapping = stepOutputsAreMappingForm(step.outputs);
  if (stepKind === 'tool') {
    if (isMapping) return;
    ctx.addIssue({
      code: 'custom',
      path: ['outputs'],
      message: 'The `outputs` mapping form is required on a tool step.',
    });
    return;
  }
  addWorkflowDocumentOutputSourceIssues(step.outputs, stepKind, ctx);
  if (!stepOutputsContainMappingForm(step.outputs)) return;
  ctx.addIssue({
    code: 'custom',
    path: ['outputs'],
    message: `The \`outputs\` declaration form is required on ${articleForStepKind(stepKind)} ${stepKind} step.`,
  });
}

function addWorkflowDocumentOutputSourceIssues(
  outputs: Readonly<Record<string, unknown>>,
  stepKind: 'agent' | 'checkout' | 'run',
  ctx: z.RefinementCtx,
): void {
  let stdoutOutput: string | undefined;
  for (const [key, declaration] of Object.entries(outputs)) {
    if (typeof declaration !== 'object' || declaration === null) continue;
    const sources = declaration as {from_file?: unknown; from_stdout?: unknown};
    for (const field of ['from_file', 'from_stdout'] as const) {
      if (sources[field] === undefined || stepKind === 'run') continue;
      ctx.addIssue({
        code: 'custom',
        path: ['outputs', key, field],
        message: `\`${field}\` is only supported on run steps.`,
      });
    }
    if (stepKind !== 'run' || sources.from_stdout === undefined) continue;
    if (stdoutOutput !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['outputs', key, 'from_stdout'],
        message: `Only one output of a step can use \`from_stdout\`. "${stdoutOutput}" already does.`,
      });
      continue;
    }
    stdoutOutput = key;
  }
}

function validateWorkflowDocumentRunStep(
  step: WorkflowDocumentStepInput,
  ctx: z.RefinementCtx,
): void {
  addWorkflowDocumentInvalidStepFields(step, ctx, 'run', workflowDocumentStepKindInvalidFields.run);
}

function validateWorkflowDocumentToolStep(
  step: WorkflowDocumentStepInput,
  ctx: z.RefinementCtx,
): void {
  addWorkflowDocumentInvalidStepFields(
    step,
    ctx,
    'tool',
    workflowDocumentStepKindInvalidFields.tool,
  );
  if (step.with !== undefined) addWorkflowDocumentToolWithMethodIssue(step.with, ctx, ['with']);
}

function validateWorkflowDocumentActionStep(
  step: WorkflowDocumentStepInput,
  ctx: z.RefinementCtx,
): void {
  addWorkflowDocumentInvalidStepFields(
    step,
    ctx,
    'action',
    workflowDocumentStepKindInvalidFields.action,
  );
  if (step.uses !== undefined && WORKFLOW_LITERAL_NAME_PATTERN.test(step.uses)) {
    const result = parseWorkflowActionRef(step.uses);
    if (!result.ok) ctx.addIssue({code: 'custom', path: ['uses'], message: result.message});
  }
  if (step.with !== undefined) addWorkflowDocumentActionWithSecretIssues(step.with, ctx);
}

function validateWorkflowDocumentCheckoutStep(
  step: WorkflowDocumentStepInput,
  ctx: z.RefinementCtx,
): void {
  addWorkflowDocumentInvalidStepFields(
    step,
    ctx,
    'checkout',
    workflowDocumentStepKindInvalidFields.checkout,
  );
}

function addWorkflowDocumentInvalidStepFields(
  step: WorkflowDocumentStepInput,
  ctx: z.RefinementCtx,
  stepKind: WorkflowDocumentStepKind,
  fields: readonly (keyof WorkflowDocumentStepInput)[],
): void {
  for (const key of fields) {
    if (step[key] === undefined) continue;
    if (
      (key === 'tool' || key === 'connection' || key === 'uses') &&
      typeof step[key] === 'string' &&
      !WORKFLOW_LITERAL_NAME_PATTERN.test(step[key])
    ) {
      // The field-level literal-name check already rejected the interpolated
      // value; skip the exclusivity issue so one defect does not report twice.
      continue;
    }
    ctx.addIssue({
      code: 'custom',
      path: [key],
      message: `"${key}" is not valid on ${articleForStepKind(stepKind)} ${stepKind} step.`,
    });
  }
}

function validateWorkflowDocumentAgentStep(
  step: WorkflowDocumentStepInput,
  ctx: z.RefinementCtx,
): void {
  if (hasToolOnlyField(step)) {
    if (hasInvalidToolOnlyField(step)) return;
    ctx.addIssue({
      code: 'custom',
      path: ['tool'],
      message:
        'A tool step requires `tool`; `connection` is only valid alongside it, and `with` alongside `tool` or `uses`.',
    });
    return;
  }
  const isAgent = workflowDocumentAgentStepFields.some((field) => step[field] !== undefined);
  if (!isAgent) {
    ctx.addIssue({
      code: 'custom',
      message:
        'A step must define either "run", an agent "prompt", a "checkout", a "tool", or "uses".',
    });
    return;
  }
  if (step.env !== undefined) {
    ctx.addIssue({code: 'custom', path: ['env'], message: '"env" is supported only on run steps.'});
  }
  addWorkflowDocumentInvalidStepFields(
    step,
    ctx,
    'agent',
    workflowDocumentStepKindInvalidFields.agent,
  );
  if (step.prompt === undefined) {
    ctx.addIssue({code: 'custom', path: ['prompt'], message: 'An agent step requires "prompt".'});
  }
}

function hasToolOnlyField(step: WorkflowDocumentStepInput): boolean {
  return step.tool === undefined && (step.connection !== undefined || step.with !== undefined);
}

function hasInvalidToolOnlyField(step: WorkflowDocumentStepInput): boolean {
  return (
    step.tool === undefined &&
    step.connection !== undefined &&
    (step.connection.length === 0 || !WORKFLOW_LITERAL_NAME_PATTERN.test(step.connection))
  );
}

function articleForStepKind(stepKind: WorkflowDocumentStepKind): 'a' | 'an' {
  return stepKind === 'agent' || stepKind === 'action' ? 'an' : 'a';
}

/**
 * Validates a repository action path, such as an uploaded action directory.
 * Registry references are not paths, so they get the remote-action message.
 */
export function workflowDocumentActionPathIssue(uses: string): string | undefined {
  const result = parseWorkflowActionRef(uses);
  if (result.ok && result.ref.kind === 'local') return undefined;
  if (!(result.ok || result.registry)) return result.message;
  return REMOTE_ACTIONS_UNSUPPORTED_MESSAGE;
}

const workflowDocumentSecretReferencePattern = /(?<!\$)\$\{\{[^}]*\bsecrets\b/;
// `secrets.KEY` or `secrets.<store>.KEY`; the model layer checks the store and
// key against the secrets schemas.
const workflowDocumentBareSecretReferencePattern =
  /^\$\{\{\s*secrets(?:\.[A-Za-z_][A-Za-z0-9_]*){1,2}\s*\}\}$/;

// Secret inputs are filled on the runner by input name, so a secret must be
// the whole value of a top-level input. The model layer repeats the check with
// the expression parser.
function addWorkflowDocumentActionWithSecretIssues(
  withValue: Readonly<Record<string, unknown>>,
  ctx: z.RefinementCtx,
): void {
  const pending = workflowDocumentJsonChildEntries(withValue, ['with']);
  // YAML aliases can share or nest objects, so each object is visited once.
  const visited = new Set<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) continue;
    const {value, path} = current;
    if (typeof value === 'string') {
      if (!isMisplacedSecretReference(value, path)) continue;
      ctx.addIssue({
        code: 'custom',
        path,
        message:
          'Secret references in `with` must be the whole value of a top-level input, such as `$' +
          '{{ secrets.NPM_TOKEN }}`.',
      });
      continue;
    }
    if (value === null || typeof value !== 'object' || visited.has(value)) continue;
    visited.add(value);
    for (const entry of workflowDocumentJsonChildEntries(value, path)) pending.push(entry);
  }
}

function isMisplacedSecretReference(value: string, path: readonly (string | number)[]): boolean {
  if (!workflowDocumentSecretReferencePattern.test(value)) return false;
  // `with.<input>` is a top-level input.
  return path.length !== 2 || !workflowDocumentBareSecretReferencePattern.test(value);
}

function workflowDocumentJsonChildEntries(
  value: object,
  path: readonly (string | number)[],
): {value: unknown; path: (string | number)[]}[] {
  return Object.entries(value).map(([key, child]) => ({
    value: child,
    path: [...path, Array.isArray(value) ? Number(key) : key],
  }));
}

function outputsMappingSchema(label: 'Job' | 'Workflow') {
  return nonEmptyRecordSchema(z.string().min(1)).superRefine((outputs, ctx) => {
    const entries = Object.keys(outputs).length;
    if (entries > WORKFLOW_DOCUMENT_JOB_OUTPUTS_MAX_ENTRIES) {
      ctx.addIssue({
        code: 'custom',
        message: `${label} outputs cannot define more than ${WORKFLOW_DOCUMENT_JOB_OUTPUTS_MAX_ENTRIES} entries.`,
      });
    }
  });
}

const workflowDocumentJobOutputsSchema = outputsMappingSchema('Job');

// `volumes` and `ports` are not fields: volumes go through `options` and the
// container shares the host network. `options` reaches `docker create` as
// written, so it is not validated here.
const workflowDocumentContainerObjectSchema = z.strictObject({
  image: z.string().min(1).meta({
    description:
      'Names the Docker image the job runs in. The `ENTRYPOINT` and `CMD` of the image do not run. Supports workflow expressions, but cannot read secrets.',
  }),
  credentials: z
    .strictObject({
      username: z.string().min(1).meta({description: 'Sets the registry username.'}),
      password: z.string().min(1).meta({description: 'Sets the registry password.'}),
    })
    .optional()
    .meta({description: 'Signs in to a private registry before the runner pulls the image.'}),
  env: workflowDocumentEnvSchema.optional().meta({
    description: 'Sets environment variables for every process in the container.',
  }),
  options: z.string().optional().meta({
    description:
      'Passes extra flags to `docker create`, as written. Do not set `--network` or `--entrypoint`: the runner sets them. Supports workflow expressions, but cannot read secrets.',
  }),
  docker_socket: z.boolean().optional().meta({
    description: 'Mounts the Docker socket of the runner into the container. Defaults to `true`.',
  }),
});

export const workflowDocumentContainerSchema = z
  .union([z.string().min(1), workflowDocumentContainerObjectSchema])
  .meta({
    description:
      'Runs this job in a Docker container. Set a string for the image, or an object for the image and its settings.',
  });

/** Why a step cannot be a member of a `parallel` block, by the field that says so. */
const workflowDocumentParallelMemberIssues = [
  ['checkout', 'A checkout step cannot be in a `parallel` block.'],
  ['wait', 'A wait step cannot be in a `parallel` block.'],
  ['wait_all', 'A wait step cannot be in a `parallel` block.'],
  ['cancel', 'A cancel step cannot be in a `parallel` block.'],
  [
    'background',
    '`background` is not valid on a step in a `parallel` block. The block already runs its steps in the background.',
  ],
  ['gate', 'A gate cannot be used on a step in a `parallel` block.'],
] as const;

export const workflowDocumentParallelBlockSchema = z
  .strictObject({
    parallel: z.array(workflowDocumentStepSchema).min(2).meta({
      description:
        'Runs the listed steps at the same time, then waits for all of them. It is shorthand for marking each step `background: true` and adding a `wait` that names exactly those steps. A step needs no `key`, but without one its outputs are not readable.',
    }),
  })
  .superRefine((block, ctx) => {
    for (const [index, member] of block.parallel.entries()) {
      for (const [field, message] of workflowDocumentParallelMemberIssues) {
        if (member[field] === undefined) continue;
        ctx.addIssue({code: 'custom', path: ['parallel', index, field], message});
      }
    }
  });

export type WorkflowDocumentParallelBlock = z.infer<typeof workflowDocumentParallelBlockSchema>;
/** One entry of a job's `steps`: a step, or a `parallel` block of steps. */
export type WorkflowDocumentJobStep = WorkflowDocumentStep | WorkflowDocumentParallelBlock;

export function isWorkflowDocumentParallelBlock(
  step: WorkflowDocumentJobStep,
): step is WorkflowDocumentParallelBlock {
  return 'parallel' in step;
}

function isParallelBlockInput(value: unknown): boolean {
  return typeof value === 'object' && value !== null && Object.hasOwn(value, 'parallel');
}

// A union would report any step error as one `invalid_union` issue at the entry.
// Dispatching on the `parallel` key keeps each error at the field that caused it.
// The JSON Schema for the entry is built by `buildWorkflowJsonSchema`.
//
// Without `concurrentSteps`, an entry that names a concurrency key fails with "not supported yet",
// whoever parses it, so the schema itself keeps the feature off.
function createWorkflowDocumentJobStepSchema(concurrentSteps: boolean) {
  return z.unknown().transform((value, ctx): WorkflowDocumentJobStep => {
    if (!concurrentSteps && addUnsupportedConcurrencyIssues(value, ctx)) return z.NEVER;
    const isBlock = isParallelBlockInput(value);
    // The nested block reports once, instead of also failing the strict member schema.
    if (isBlock && addNestedParallelIssues(value, ctx)) return z.NEVER;
    const result = (
      isBlock ? workflowDocumentParallelBlockSchema : workflowDocumentStepSchema
    ).safeParse(value);
    if (result.success) return result.data;
    for (const issue of result.error.issues) {
      ctx.issues.push({...issue, input: value} as z.core.$ZodRawIssue);
    }
    return z.NEVER;
  });
}

const workflowDocumentConcurrentStepKeys = [
  'background',
  ...workflowDocumentControlStepFields,
  'parallel',
] as const;

function addUnsupportedConcurrencyIssues(value: unknown, ctx: z.core.$RefinementCtx): boolean {
  if (typeof value !== 'object' || value === null) return false;
  let found = false;
  for (const key of workflowDocumentConcurrentStepKeys) {
    const field = (value as Record<string, unknown>)[key];
    if (field === undefined) continue;
    found = true;
    ctx.issues.push({
      code: 'custom',
      input: field,
      path: [key],
      message: `Concurrent steps (\`${key}\`) are not supported yet.`,
    });
  }
  return found;
}

function addNestedParallelIssues(value: unknown, ctx: z.core.$RefinementCtx): boolean {
  const members = (value as {parallel?: unknown}).parallel;
  if (!Array.isArray(members)) return false;
  let found = false;
  for (const [index, member] of members.entries()) {
    if (!isParallelBlockInput(member)) continue;
    found = true;
    ctx.issues.push({
      code: 'custom',
      input: member,
      path: ['parallel', index],
      message: 'A `parallel` block cannot be nested in another `parallel` block.',
    });
  }
  return found;
}

function createWorkflowDocumentJobSchema(concurrentSteps: boolean) {
  return z.strictObject({
    needs: stringOrStringArraySchema.optional().meta({
      description: 'Lists the jobs that must finish before this job starts.',
    }),
    if: z.string().min(1).optional().meta({
      description:
        'Runs this job only when the condition is true. See [Conditionals](/reference/expressions#syntax).',
    }),
    run_after: runAfterSchema.optional().meta({
      description:
        'Picks when this job runs relative to the jobs in `needs`: `success` (default) needs every job to succeed, `failure` needs at least one job to fail, `always` runs whatever their status. The `if` is checked after `run_after` passes.',
    }),
    runner: stringOrStringArraySchema.optional().meta({
      description:
        'Selects the runner for this job. List labels in fallback order. See [Runners and execution environments](/understand/runners-and-execution-environments).',
    }),
    success: z.string().min(1).optional().meta({
      description:
        'Marks the job as successful when the condition returns `true`. See [Expressions](/reference/expressions#functions-and-macros) and [Contexts](/reference/contexts#context-availability).',
    }),
    outputs: workflowDocumentJobOutputsSchema.optional().meta({
      description:
        "Creates named outputs from values produced by this job's steps. A later job must list this job in `needs` before it can use them.",
    }),
    execution_timeout: z.string().min(1).optional().meta({
      description: 'Stops one job execution after this duration.',
    }),
    checkout: workflowDocumentJobCheckoutSchema.optional(),
    container: workflowDocumentContainerSchema.optional(),
    listening: workflowDocumentListeningSchema.optional().meta({
      description:
        'Keeps the job open for matching events. Set `until`, `timeout`, or `max_executions` to end it. See [Listening jobs](/understand/listening-jobs).',
    }),
    name: jobNameSchema.optional(),
    execution_name: z.string().min(1).optional().meta({
      description: 'Sets the name of each job execution. Supports workflow expressions.',
    }),
    env: workflowDocumentEnvSchema.optional().meta({
      description: 'Sets environment variables for every run step in this job.',
    }),
    steps: z.array(createWorkflowDocumentJobStepSchema(concurrentSteps)).min(1).meta({
      description: 'Lists the steps that this job runs in order.',
    }),
  });
}

export const workflowDocumentJobSchema = createWorkflowDocumentJobSchema(false);

function createWorkflowDocumentSchema(concurrentSteps: boolean) {
  const jobSchema = createWorkflowDocumentJobSchema(concurrentSteps);
  return z.strictObject({
    name: workflowNameSchema,
    run_name: z.string().min(1).optional().meta({
      description: 'Names each workflow run. Supports workflow expressions.',
    }),
    runner: stringOrStringArraySchema.optional().meta({
      description:
        'Selects the default runner for jobs in this workflow. List labels in fallback order. See [Runners and execution environments](/understand/runners-and-execution-environments).',
    }),
    env: workflowDocumentEnvSchema.optional().meta({
      description: 'Sets environment variables for run steps in every job.',
    }),
    concurrency: workflowDocumentConcurrencySchema.optional(),
    triggers: nonEmptyRecordSchema(workflowDocumentTriggerSchema).optional().meta({
      description:
        'Defines the events that start the workflow. Add no more than one `manual` trigger.',
    }),
    jobs: nonEmptyRecordSchema(jobSchema).meta({
      description: 'Defines the jobs that the workflow runs. Add at least one job.',
    }),
    outputs: outputsMappingSchema('Workflow').optional().meta({
      description:
        'Creates named outputs from job outputs when a run succeeds. An output that cannot be evaluated fails the run.',
    }),
  });
}

/** Rejects `background`, `wait`, `wait_all`, `cancel`, and `parallel` with "not supported yet". */
export const workflowDocumentSchema = createWorkflowDocumentSchema(false);
/** Accepts concurrent steps. `parseWorkflowDocument` picks it with `{concurrentSteps: true}`. */
export const concurrentWorkflowDocumentSchema = createWorkflowDocumentSchema(true);

export type WorkflowDocumentStep = z.infer<typeof workflowDocumentStepSchema>;
export type WorkflowDocumentGateFailureRule = z.infer<typeof workflowDocumentGateFailureRuleSchema>;
export type WorkflowDocumentJob = z.infer<typeof workflowDocumentJobSchema>;
export type WorkflowDocumentConcurrency = z.infer<typeof workflowDocumentConcurrencySchema>;
export type WorkflowDocument = z.infer<typeof workflowDocumentSchema>;
export type WorkflowDocumentCheckout = z.infer<typeof workflowDocumentCheckoutSchema>;
export type WorkflowDocumentJobCheckout = z.infer<typeof workflowDocumentJobCheckoutSchema>;
export type WorkflowDocumentContainer = z.infer<typeof workflowDocumentContainerSchema>;
export type WorkflowDocumentEnv = z.infer<typeof workflowDocumentEnvSchema>;
export type WorkflowDocumentJobListening = z.infer<typeof workflowDocumentListeningSchema>;
export type WorkflowDocumentRunStepGate = z.infer<typeof workflowDocumentStepGateSchema>;
export type WorkflowDocumentStepIntegration = z.infer<typeof workflowDocumentStepIntegrationSchema>;
export type WorkflowDocumentAgentMcpServer = z.infer<typeof workflowDocumentAgentMcpServerSchema>;
export type WorkflowDocumentStepOutputType = (typeof workflowDocumentStepOutputTypes)[number];
export type WorkflowDocumentStepOutputs = z.infer<typeof workflowDocumentStepOutputsSchema>;
export type WorkflowDocumentToolStepOutputs = z.infer<typeof workflowDocumentToolStepOutputsSchema>;
export type WorkflowDocumentToolWith = z.infer<typeof workflowDocumentToolStepWithSchema>;
export type WorkflowDocumentSession = z.infer<typeof workflowDocumentSessionSchema>;
export type WorkflowDocumentRepositoryContext = z.infer<
  typeof workflowDocumentRepositoryContextSchema
>;
export type WorkflowDocumentTrigger = z.infer<typeof workflowDocumentTriggerSchema>;

type JsonDepthTask =
  | {kind: 'enter'; value: unknown; depth: number}
  | {kind: 'leave'; value: object};

function maxJsonDepth(value: unknown): number {
  let maximumDepth = 0;
  const activeObjects = new Set<object>();
  const pending: JsonDepthTask[] = [{kind: 'enter', value, depth: 0}];

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) continue;

    if (current.kind === 'leave') {
      activeObjects.delete(current.value);
      continue;
    }

    if (current.value === null || typeof current.value !== 'object') continue;
    if (activeObjects.has(current.value)) continue;

    activeObjects.add(current.value);
    const depth = current.depth + 1;
    maximumDepth = Math.max(maximumDepth, depth);
    pending.push({kind: 'leave', value: current.value});
    const children = Object.values(current.value);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push({kind: 'enter', value: children[index], depth});
    }
  }

  return maximumDepth;
}

function isJsonSchemaDocument(value: unknown): boolean {
  return (
    typeof value === 'boolean' ||
    (typeof value === 'object' && value !== null && !Array.isArray(value))
  );
}
