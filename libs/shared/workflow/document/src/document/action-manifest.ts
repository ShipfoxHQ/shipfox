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
  type WorkflowDocumentStepOutputType,
  workflowDocumentActionAliasSchema,
  workflowDocumentStepOutputTypes,
} from './workflow-document.js';

export const ACTION_MANIFEST_RUNTIMES = ['node24'] as const;
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

function valueRecordSchema<ValueSchema extends z.ZodType>(valueSchema: ValueSchema) {
  return z
    .record(actionManifestValueNameSchema, valueSchema)
    .refine((values) => Object.keys(values).length <= ACTION_MANIFEST_VALUES_MAX_ENTRIES, {
      message: `Define no more than ${ACTION_MANIFEST_VALUES_MAX_ENTRIES} entries.`,
    });
}

export const actionManifestSchema = z.strictObject({
  name: z.string().min(1).max(128).meta({description: 'Names the action.'}),
  description: z.string().max(1024).optional().meta({description: 'Describes the action.'}),
  runtime: z.enum(ACTION_MANIFEST_RUNTIMES).optional().meta({
    description: 'Selects the runtime. Only `node24` is supported.',
  }),
  main: z
    .string()
    .regex(actionManifestMainPattern, {
      message: '`main` must be a .ts, .mts, .js, or .mjs file.',
    })
    .refine(isNormalizedRelativePath, {
      message:
        '`main` must be a path inside the action directory, such as `index.ts`, without `./`, `..`, or a leading `/`.',
    })
    .meta({description: 'Sets the entry file, relative to the action directory.'}),
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
});

export type ActionManifest = z.infer<typeof actionManifestSchema>;
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
  schema.$schema = 'https://json-schema.org/draft/2020-12/schema';
  schema.$id = id;
  schema.title = 'Shipfox Action';
  return schema;
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
