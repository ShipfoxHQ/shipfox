import {z} from 'zod';
import {
  isNormalizedRelativePath,
  isWorkflowRegistryPackageName,
  isWorkflowRegistrySlug,
} from './action-ref.js';
import {
  validateWorkflowDocumentValueDeclaration,
  WORKFLOW_DOCUMENT_STEP_OUTPUT_KEY_PATTERN,
  WORKFLOW_DOCUMENT_STEP_OUTPUTS_MAX_ENTRIES,
  type WorkflowDocumentStep,
  type WorkflowDocumentStepOutputType,
  workflowDocumentActionAliasSchema,
  workflowDocumentCompositeStepSchema,
  workflowDocumentStepOutputTypes,
} from './workflow-document.js';

export const ACTION_MANIFEST_RUNTIMES = ['node24'] as const;
const ACTION_MANIFEST_POST_FAILURES = ['warn', 'fail'] as const;
export const ACTION_MANIFEST_VALUES_MAX_ENTRIES = WORKFLOW_DOCUMENT_STEP_OUTPUTS_MAX_ENTRIES;
export const ACTION_MANIFEST_KEYWORDS_MAX_ENTRIES = 10;

type JsonSchema = Record<string, unknown>;

const actionManifestMainPattern = /\.(?:ts|mts|js|mjs)$/;

const actionManifestValueNameSchema = z
  .string()
  .regex(WORKFLOW_DOCUMENT_STEP_OUTPUT_KEY_PATTERN, {message: 'Names must be identifiers.'});

const actionManifestValueTypeSchema = z
  .enum(workflowDocumentStepOutputTypes)
  .default('string')
  .meta({description: 'Declares the value type. Use `json` with `schema` for structured values.'});

const actionManifestValueSchemaField = z.unknown().optional().meta({
  description: 'JSON Schema for a `json` value.',
});

const actionManifestDescriptionSchema = z.string().max(1024).optional().meta({
  description: 'Describes the value.',
});

const actionManifestInputSchema = z
  .strictObject({
    type: actionManifestValueTypeSchema,
    schema: actionManifestValueSchemaField,
    required: z.boolean().default(false).meta({
      description: 'Set to `true` when every step that uses the action must provide the input.',
    }),
    default: z.unknown().optional().meta({
      description: 'Applies when the step omits the input. It does not replace `null`.',
    }),
    secret: z
      .boolean()
      .optional()
      .meta({
        description:
          'Set to `true` when the input receives a secret, such as `$' +
          '{{ secrets.NPM_TOKEN }}`. Composite actions only. A secret input is a string without a default.',
      }),
    description: actionManifestDescriptionSchema,
  })
  .superRefine((input, ctx) => {
    validateWorkflowDocumentValueDeclaration(input, ctx);
    if (input.default === undefined || matchesValueType(input.type, input.default)) return;
    ctx.addIssue({
      code: 'custom',
      path: ['default'],
      message: `The default must be a ${input.type} value.`,
    });
  });

const actionManifestOutputSchema = z
  .strictObject({
    type: actionManifestValueTypeSchema,
    schema: actionManifestValueSchemaField,
    required: z.boolean().default(false).meta({
      description: 'Set to `true` when the action must always set the output.',
    }),
    value: z.string().min(1).optional().meta({
      description:
        'Computes the output from the `inputs` and `steps` of a composite action. Required on composite actions, and not valid on JavaScript actions.',
    }),
    description: actionManifestDescriptionSchema,
  })
  .superRefine((output, ctx) => validateWorkflowDocumentValueDeclaration(output, ctx));

// Grants stay readable in review, so every selector names its tools.
const actionManifestSelectorSchema = z
  .string()
  .min(1)
  .regex(/^[^*]+$/, {message: 'Selectors must name tools explicitly. Wildcards are not allowed.'});

const actionManifestIntegrationSchema = z.strictObject({
  provider: z
    .string()
    .min(1)
    .meta({description: 'Names the integration provider, such as `slack`.'}),
  include: z.array(actionManifestSelectorSchema).min(1).meta({
    description: 'Lists the tools the action can call: a tool id, a family, or `family.method`.',
  }),
  allow_write: z.boolean().default(false).meta({
    description: 'Set to `true` to allow tools that change external data.',
  }),
});

function actionManifestEntrySchema(field: string) {
  return z
    .string()
    .regex(actionManifestMainPattern, {
      message: `\`${field}\` must be a .ts, .mts, .js, or .mjs file.`,
    })
    .refine(isNormalizedRelativePath, {
      message: `\`${field}\` must be a path inside the action directory, such as \`index.ts\`, without \`./\`, \`..\`, or a leading \`/\`.`,
    });
}

function valueRecordSchema<ValueSchema extends z.ZodType>(valueSchema: ValueSchema) {
  return z
    .record(actionManifestValueNameSchema, valueSchema)
    .refine((values) => Object.keys(values).length <= ACTION_MANIFEST_VALUES_MAX_ENTRIES, {
      message: `Define no more than ${ACTION_MANIFEST_VALUES_MAX_ENTRIES} entries.`,
    });
}

const actionManifestObjectSchema = z
  .strictObject({
    name: z.string().min(1).max(128).meta({description: 'Names the action.'}),
    description: z.string().max(1024).optional().meta({description: 'Describes the action.'}),
    runtime: z.enum(ACTION_MANIFEST_RUNTIMES).optional().meta({
      description: 'Selects the runtime. Only `node24` is supported.',
    }),
    main: actionManifestEntrySchema('main').optional().meta({
      description:
        'Sets the entry file of a JavaScript action, relative to the action directory. Set either `main` or `steps`.',
    }),
    post: actionManifestEntrySchema('post').optional().meta({
      description:
        'Sets the entry file that runs at the end of the job, relative to the action directory. It must differ from `main`.',
    }),
    post_failure: z.enum(ACTION_MANIFEST_POST_FAILURES).optional().meta({
      description:
        'Decides what a failed `post` does. `warn` (the default) keeps the job result. `fail` fails the job. Requires `post`.',
    }),
    steps: z.array(workflowDocumentCompositeStepSchema).min(1).optional().meta({
      description:
        'Lists the steps of a composite action. They run in the job of the step that uses the action. Set either `main` or `steps`.',
    }),
    inputs: valueRecordSchema(actionManifestInputSchema).optional().meta({
      description: 'Declares the inputs that steps provide with `with`.',
    }),
    outputs: valueRecordSchema(actionManifestOutputSchema).optional().meta({
      description: 'Declares the outputs that later steps can read.',
    }),
    integrations: z
      .record(workflowDocumentActionAliasSchema, actionManifestIntegrationSchema)
      .optional()
      .meta({
        description:
          'Declares integration aliases. Each step that uses the action binds every alias with `connections`.',
      }),
    keywords: z
      .array(
        z.string().refine(isWorkflowRegistrySlug, {
          message: 'Keywords use 2 to 40 lowercase letters, digits, and single hyphens.',
        }),
      )
      .max(ACTION_MANIFEST_KEYWORDS_MAX_ENTRIES)
      .optional()
      .meta({description: 'Lists search keywords for the registry page.'}),
    related: z
      .array(
        z.string().refine(isWorkflowRegistryPackageName, {
          message: 'Related packages are registry names, such as `shipfox/slack-thread-digest`.',
        }),
      )
      .optional()
      .meta({description: 'Links other registry packages from the registry page.'}),
  })
  .superRefine((manifest, ctx) => {
    if (manifest.steps === undefined) {
      validateJavascriptManifest(manifest, ctx);
    } else {
      validateCompositeManifest(manifest, ctx);
    }
  });

type ParsedActionManifest = z.infer<typeof actionManifestObjectSchema>;
type ActionManifestCommon = Omit<
  ParsedActionManifest,
  'main' | 'runtime' | 'post' | 'post_failure' | 'steps'
>;

/** An action whose body is JavaScript code (`main`). */
export type JavascriptActionManifest = ActionManifestCommon & {
  readonly main: string;
  readonly runtime?: ParsedActionManifest['runtime'];
  readonly post?: string;
  readonly post_failure?: ParsedActionManifest['post_failure'];
  readonly steps?: undefined;
};

/** An action whose body is a list of workflow steps (`steps`). */
export type CompositeActionManifest = ActionManifestCommon & {
  readonly steps: WorkflowDocumentStep[];
  readonly main?: undefined;
  readonly runtime?: undefined;
  readonly post?: undefined;
  readonly post_failure?: undefined;
};

export type ActionManifest = JavascriptActionManifest | CompositeActionManifest;

export const actionManifestSchema = actionManifestObjectSchema.transform(
  (manifest) => manifest as ActionManifest,
);

export function isCompositeActionManifest(
  manifest: ActionManifest,
): manifest is CompositeActionManifest {
  return manifest.steps !== undefined;
}

export interface ParseActionManifestOptions {
  /** Accepts composite actions (`steps`). Defaults to `false`. */
  compositeActions?: boolean;
}

/**
 * Parses an `action.yml` value like `actionManifestSchema.safeParse`. Without
 * `compositeActions`, a manifest with `steps` reports only that composite
 * actions are not supported yet.
 */
export function safeParseActionManifest(
  input: unknown,
  {compositeActions = false}: ParseActionManifestOptions = {},
): z.ZodSafeParseResult<ActionManifest> {
  if (!compositeActions && isRecord(input) && input.steps !== undefined) {
    return {
      success: false,
      error: new z.ZodError([
        {
          code: 'custom',
          input: input.steps,
          path: ['steps'],
          message: 'Composite actions (`steps`) are not supported yet.',
        },
      ]) as z.ZodError<ActionManifest>,
    };
  }
  return actionManifestSchema.safeParse(input);
}

function validateJavascriptManifest(manifest: ParsedActionManifest, ctx: z.RefinementCtx): void {
  if (manifest.main === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['main'],
      message: 'Set `main` for a JavaScript action, or `steps` for a composite action.',
    });
  }
  if (manifest.post === undefined && manifest.post_failure !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['post_failure'],
      message: '`post_failure` requires `post`.',
    });
  }
  if (manifest.post !== undefined && manifest.post === manifest.main) {
    ctx.addIssue({
      code: 'custom',
      path: ['post'],
      message: '`post` must differ from `main`.',
    });
  }
  for (const [name, input] of Object.entries(manifest.inputs ?? {})) {
    if (input.secret === undefined) continue;
    ctx.addIssue({
      code: 'custom',
      path: ['inputs', name, 'secret'],
      message:
        '`secret` is only valid on composite action inputs. A JavaScript action input can already receive a secret.',
    });
  }
  for (const [name, output] of Object.entries(manifest.outputs ?? {})) {
    if (output.value === undefined) continue;
    ctx.addIssue({
      code: 'custom',
      path: ['outputs', name, 'value'],
      message: '`value` is only valid on composite action outputs. A JavaScript action sets them.',
    });
  }
}

function validateCompositeManifest(manifest: ParsedActionManifest, ctx: z.RefinementCtx): void {
  for (const field of ['main', 'runtime', 'post', 'post_failure'] as const) {
    if (manifest[field] === undefined) continue;
    ctx.addIssue({
      code: 'custom',
      path: [field],
      message:
        field === 'main'
          ? 'Set either `main` or `steps`, not both.'
          : `\`${field}\` is only valid on a JavaScript action, which sets \`main\`.`,
    });
  }
  validateSecretInputs(manifest, ctx);
  for (const [name, output] of Object.entries(manifest.outputs ?? {})) {
    if (output.value !== undefined) continue;
    ctx.addIssue({
      code: 'custom',
      path: ['outputs', name, 'value'],
      message: 'A composite action output needs `value`, an expression over `inputs` and `steps`.',
    });
  }
}

function validateSecretInputs(manifest: ParsedActionManifest, ctx: z.RefinementCtx): void {
  for (const [name, input] of Object.entries(manifest.inputs ?? {})) {
    if (input.secret !== true) continue;
    if (input.type !== 'string') {
      ctx.addIssue({
        code: 'custom',
        path: ['inputs', name, 'type'],
        message: 'A secret input must be a string.',
      });
    }
    if (input.default !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['inputs', name, 'default'],
        message: 'A secret input cannot have a default.',
      });
    }
  }
}

export type ActionManifestInput = z.input<typeof actionManifestSchema>;
export type ActionManifestIntegration = z.infer<typeof actionManifestIntegrationSchema>;
export type ActionManifestInputDeclaration = z.infer<typeof actionManifestInputSchema>;
export type ActionManifestOutputDeclaration = z.infer<typeof actionManifestOutputSchema>;

export interface BuildActionManifestJsonSchemaOptions {
  id?: string;
}

export function buildActionManifestJsonSchema({
  id = 'https://www.shipfox.io/docs/action.schema.json',
}: BuildActionManifestJsonSchemaOptions = {}): JsonSchema {
  const schema = z.toJSONSchema(actionManifestSchema, {
    io: 'input',
    unrepresentable: 'any',
  }) as JsonSchema;
  // A JavaScript action sets `main`, a composite action sets `steps`.
  schema.oneOf = [
    {required: ['main'], not: {required: ['steps']}},
    {
      required: ['steps'],
      not: {
        anyOf: ['main', 'runtime', 'post', 'post_failure'].map((field) => ({required: [field]})),
      },
    },
  ];
  schema.$schema = 'https://json-schema.org/draft/2020-12/schema';
  schema.$id = id;
  schema.title = 'Shipfox Action';
  return schema;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function matchesValueType(type: WorkflowDocumentStepOutputType, value: unknown): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'json':
      return isJsonValue(value) && isSerializable(value);
  }
}

function isJsonValue(value: unknown): boolean {
  const pending: unknown[] = [value];
  const visited = new Set<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current !== 'object' || current === null) {
      if (isJsonPrimitive(current)) continue;
      return false;
    }
    // YAML aliases can share objects, so each object is checked once.
    if (visited.has(current)) continue;
    visited.add(current);
    const children = jsonChildren(current);
    if (children === undefined) return false;
    for (const child of children) pending.push(child);
  }
  return true;
}

function isJsonPrimitive(value: unknown): boolean {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

function jsonChildren(value: object): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  return Object.values(value);
}

// YAML aliases can build a cycle, which has no JSON form.
function isSerializable(value: unknown): boolean {
  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
}
