import {parse as parseYaml} from 'yaml';
import {z} from 'zod';
import {CaseValidationError, formatValidationIssues} from './schema.js';

export const CONTRACT_MODES = ['real', 'fake'] as const;
export const CONTRACT_KINDS = ['read', 'round-trip', 'error'] as const;
export const BACKLOG_KINDS = ['read', 'write'] as const;
export const TARGET_KINDS = ['absent', 'inaccessible'] as const;

export type ContractKind = (typeof CONTRACT_KINDS)[number];

const NAME_PATTERN = /^[a-z][a-z0-9_]*$/u;
const FIELD_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;
// A path into a tool result, such as `messages[0].reactions`.
const PATH_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(\[\d+\])*(\.[A-Za-z_][A-Za-z0-9_]*(\[\d+\])*)*$/u;
// Tool names are the catalog's: `issue_read` for most providers, `execute-sql` for PostHog.
const TOOL_PATTERN = /^[a-z][a-z0-9_-]*$/u;
const ERROR_CODE_PATTERN = /^[a-z][a-z0-9-]*$/u;
const ISSUE_PATTERN = /^[A-Z]+-\d+$/u;

const nameSchema = z.string().regex(NAME_PATTERN, 'must be lowercase letters, digits, and `_`');
const pathSchema = z.string().regex(PATH_PATTERN, 'must be a path such as `messages[0].text`');
const toolSchema = z.string().regex(TOOL_PATTERN);
const scalarSchema = z.union([z.string(), z.number(), z.boolean()]);

export type ContractScalar = z.infer<typeof scalarSchema>;

const SHAPE_TYPES = ['string', 'number', 'boolean', 'list', 'object'] as const;

export type ContractShape =
  | (typeof SHAPE_TYPES)[number]
  | {[field: string]: ContractShape}
  | [{[field: string]: ContractShape}];

const shapeMapSchema: z.ZodType<{[field: string]: ContractShape}> = z.lazy(() =>
  z.record(z.string().min(1), shapeSchema).refine((map) => Object.keys(map).length > 0, {
    message: 'must name at least one field',
  }),
);

/**
 * A type name, a nested map of fields, or `[{...}]` for a non-empty list checked on its first
 * item. A map never closes: fields the shape doesn't name are allowed.
 */
const shapeSchema: z.ZodType<ContractShape> = z.lazy(() =>
  z.union([z.enum(SHAPE_TYPES), shapeMapSchema, z.tuple([shapeMapSchema])]),
);

const outputExpectSchema = z
  .object({
    shape: shapeSchema.optional(),
    values: z.record(pathSchema, scalarSchema).optional(),
    includes: z.record(pathSchema, z.record(pathSchema, scalarSchema)).optional(),
  })
  .strict();

const stepExpectSchema = outputExpectSchema
  .extend({error: z.string().regex(ERROR_CODE_PATTERN).optional()})
  .strict()
  .refine(
    (expected) =>
      expected.error === undefined ||
      (expected.shape === undefined &&
        expected.values === undefined &&
        expected.includes === undefined),
    {message: 'a step that expects an error has no output to check', path: ['error']},
  );

const effectSchema = z
  .object({
    tool: toolSchema,
    method: nameSchema.optional(),
    with: z.record(z.string().min(1), z.unknown()).default({}),
    expect: outputExpectSchema.default({}),
  })
  .strict();

const stepSchema = z
  .object({
    key: nameSchema.optional(),
    tool: toolSchema,
    method: nameSchema.optional(),
    with: z.record(z.string().min(1), z.unknown()).default({}),
    expect: stepExpectSchema.default({}),
    effect: effectSchema.optional(),
  })
  .strict();

export type ContractStep = z.infer<typeof stepSchema>;

/** One contract case. It becomes one job in its provider's workflow. */
export const contractCaseSchema = z
  .object({
    provider: nameSchema,
    kind: z.enum(CONTRACT_KINDS).default('read'),
    modes: z
      .array(z.enum(CONTRACT_MODES))
      .min(1)
      .refine((modes) => new Set(modes).size === modes.length, {message: 'must not repeat a mode'}),
    steps: z.array(stepSchema).min(1),
  })
  .strict()
  .superRefine((contractCase, context) => {
    const keys = new Set<string>();
    contractCase.steps.forEach((step, index) => {
      if (step.key !== undefined) {
        if (keys.has(step.key)) {
          context.addIssue({
            code: 'custom',
            path: ['steps', index, 'key'],
            message: `step key "${step.key}" is used twice`,
          });
        }
        keys.add(step.key);
      }
      if (contractCase.kind !== 'error' && step.expect.error !== undefined) {
        context.addIssue({
          code: 'custom',
          path: ['steps', index, 'expect', 'error'],
          message: 'only a case of kind `error` expects an error',
        });
      }
    });
    if (
      contractCase.kind === 'error' &&
      !contractCase.steps.some((step) => step.expect.error !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['steps'],
        message: 'a case of kind `error` needs a step with `expect.error`',
      });
    }
  });

export type ContractCase = z.infer<typeof contractCaseSchema>;

/**
 * A tool that is never contracted, or a whole provider when `tool` is left out. It sits in the
 * provider's directory in place of a case.
 */
export const contractExemptionSchema = z
  .object({
    provider: nameSchema,
    exempt: z
      .object({
        tool: toolSchema.optional(),
        method: nameSchema.optional(),
        reason: z.string().min(1),
      })
      .strict()
      .refine((exempt) => exempt.method === undefined || exempt.tool !== undefined, {
        message: 'a method needs its tool',
        path: ['method'],
      }),
  })
  .strict();

export type ContractExemption = z.infer<typeof contractExemptionSchema>;

const fixtureFieldsSchema = z.record(z.string().regex(FIELD_PATTERN), scalarSchema);

const targetSchema = z
  .object({kind: z.enum(TARGET_KINDS)})
  .catchall(scalarSchema)
  .refine((target) => Object.keys(target).every((field) => FIELD_PATTERN.test(field)), {
    message: 'field names must be letters, digits, and `_`',
  });

const providerSandboxSchema = z
  .object({
    // The slug of the provider's sandbox connection, such as `linear_sandbox`.
    connection: nameSchema,
    // Objects that exist and that the connection can read.
    fixtures: z.record(nameSchema, fixtureFieldsSchema).default({}),
    // Objects that must fail, so error cases use them and nothing else does.
    targets: z.record(nameSchema, targetSchema).default({}),
  })
  .strict();

/** The contents of `cases/contracts/sandbox.yaml`: the sandbox accounts, per provider. */
export const sandboxManifestSchema = z.record(nameSchema, providerSandboxSchema);

export type SandboxManifest = z.infer<typeof sandboxManifestSchema>;

const backlogEntrySchema = z
  .object({
    // `<provider>.<tool>`, such as `linear.save_issue`.
    tool: z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_-]*$/u, 'must read `provider.tool`'),
    method: nameSchema.optional(),
    kind: z.enum(BACKLOG_KINDS),
    // The Linear issue of the unit that adds the case.
    issue: z.string().regex(ISSUE_PATTERN, 'must be a Linear issue such as `ENG-123`'),
  })
  .strict();

export type BacklogEntry = z.infer<typeof backlogEntrySchema>;

/** The contents of `cases/contracts/backlog.yaml`: the tools whose case isn't written yet. */
export const contractBacklogSchema = z
  .object({
    ceiling: z.number().int().nonnegative(),
    entries: z.array(backlogEntrySchema).default([]),
  })
  .strict()
  .refine(
    ({entries}) =>
      new Set(entries.map(({tool, method}) => `${tool}#${method ?? ''}`)).size === entries.length,
    {message: 'an entry is listed twice', path: ['entries']},
  );

export type ContractBacklog = z.infer<typeof contractBacklogSchema>;

function parseWith<T>({
  schema,
  value,
  path,
}: {
  schema: z.ZodType<T>;
  value: unknown;
  path: string;
}): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new CaseValidationError(path, formatValidationIssues(result.error));
  return result.data;
}

export function parseContractCase(value: unknown, path = 'case.yaml'): ContractCase {
  return parseWith({schema: contractCaseSchema, value, path});
}

export function parseContractExemption(value: unknown, path = 'exemption.yaml'): ContractExemption {
  return parseWith({schema: contractExemptionSchema, value, path});
}

export function parseSandboxManifest(value: unknown, path = 'sandbox.yaml'): SandboxManifest {
  return parseWith({schema: sandboxManifestSchema, value, path});
}

export function parseContractBacklog(value: unknown, path = 'backlog.yaml'): ContractBacklog {
  return parseWith({schema: contractBacklogSchema, value, path});
}

export function parseYamlDocument({source, path}: {source: string; path: string}): unknown {
  try {
    return parseYaml(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CaseValidationError(path, `could not parse YAML: ${message}`);
  }
}
