import {readFile} from 'node:fs/promises';
import {parse as parseYaml} from 'yaml';
import {z} from 'zod';
import {CaseValidationError, formatValidationIssues} from './schema.js';

const keySchema = z.string().regex(/^[a-z][a-z0-9_-]*$/u, 'A key is lower-case, as `deploy`.');
const runStatusSchema = z.enum(['succeeded', 'failed', 'cancelled']);

/** The catalog model that serves a live conversation. OpenRouter must map it. */
export const DEFAULT_SHIPPY_LIVE_MODEL = 'gpt-6-sol';

// A run the case fires before the conversation starts, from a workflow file next to `case.yaml`.
// Its `runner: shipfox` is replaced by the case runner's label.
const seedRunSchema = z
  .object({
    key: keySchema,
    workflow: z.string().min(1),
    inputs: z.record(z.string(), z.unknown()).default({}),
    status: runStatusSchema,
  })
  .strict();

// The page the user is on when the message is sent, as the client would report it. A `run` or
// `job` page names a seeded run by key.
const pageSchema = z.discriminatedUnion('page', [
  z.strictObject({page: z.literal('runs')}),
  z.strictObject({page: z.literal('run'), run: keySchema}),
  z.strictObject({page: z.literal('job'), run: keySchema, job: keySchema}),
  z.strictObject({page: z.literal('workflows')}),
]);

const turnSchema = z
  .object({
    message: z.string().min(1),
    page: pageSchema.optional(),
  })
  .strict();

const toolExpectationSchema = z
  .object({
    name: z.string().min(1),
    /** A subset of the call's arguments. `$runs.<key>.id` resolves to a seeded run. */
    args: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

// A pattern is a substring, or a regular expression between slashes with flags, as `/enospc/i`.
const patternSchema = z.string().min(1);

const expectSchema = z
  .object({
    /** Calls the conversation must have made, in any order. */
    tools: z.array(toolExpectationSchema).default([]),
    /** Tools the conversation must not have called. */
    tools_absent: z.array(z.string().min(1)).default([]),
    /** Checks on the last reply of the last turn. */
    reply: z
      .object({
        includes: z.array(patternSchema).default([]),
        excludes: z.array(patternSchema).default([]),
      })
      .strict()
      .default({includes: [], excludes: []}),
  })
  .strict();

export const shippyCaseSchema = z
  .object({
    modes: z
      .array(z.enum(['scripted', 'live']))
      .min(1)
      .default(['scripted']),
    timeout_seconds: z.number().int().positive().default(600),
    seed: z
      .object({runs: z.array(seedRunSchema).default([])})
      .strict()
      .default({runs: []}),
    turns: z.array(turnSchema).min(1),
    expect: expectSchema,
    live: z
      .object({model: z.string().min(1).default(DEFAULT_SHIPPY_LIVE_MODEL)})
      .strict()
      .default({
        model: DEFAULT_SHIPPY_LIVE_MODEL,
      }),
    covers: z.array(z.string().min(1)).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    const keys = new Set(value.seed.runs.map((run) => run.key));
    if (keys.size !== value.seed.runs.length) {
      context.addIssue({
        code: 'custom',
        path: ['seed', 'runs'],
        message: 'run keys must be unique',
      });
    }
    value.turns.forEach((turn, index) => {
      const page = turn.page;
      if ((page?.page === 'run' || page?.page === 'job') && !keys.has(page.run)) {
        context.addIssue({
          code: 'custom',
          path: ['turns', index, 'page', 'run'],
          message: `names no seeded run: ${page.run}`,
        });
      }
    });
  });

export type ShippyCase = z.infer<typeof shippyCaseSchema>;
export type ShippyPage = NonNullable<ShippyCase['turns'][number]['page']>;
export type ShippyExpect = ShippyCase['expect'];
export type ShippySeedRun = ShippyCase['seed']['runs'][number];

export function parseShippyCase(value: unknown, casePath = 'case.yaml'): ShippyCase {
  const result = shippyCaseSchema.safeParse(value);
  if (!result.success) {
    throw new CaseValidationError(casePath, formatValidationIssues(result.error));
  }
  return result.data;
}

export async function loadShippyCase(casePath: string): Promise<ShippyCase> {
  const source = await readFile(casePath, 'utf8');
  let document: unknown;
  try {
    document = parseYaml(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CaseValidationError(casePath, `could not parse YAML: ${message}`);
  }
  return parseShippyCase(document, casePath);
}

const RUN_REFERENCE = /^\$runs\.([a-z][a-z0-9_-]*)\.id$/u;

/**
 * Replaces every `$runs.<key>.id` string in a value with the seeded run's id. A key the case
 * didn't seed is an error, so a typo never passes as a literal.
 */
export function resolveRunReferences<T>(value: T, runs: ReadonlyMap<string, {id: string}>): T {
  if (typeof value === 'string') {
    const match = RUN_REFERENCE.exec(value);
    if (match === null) return value;
    const run = runs.get(match[1] ?? '');
    if (run === undefined) throw new Error(`No seeded run named ${match[1]} for ${value}`);
    return run.id as T;
  }
  if (Array.isArray(value)) return value.map((entry) => resolveRunReferences(entry, runs)) as T;
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, resolveRunReferences(entry, runs)]),
    ) as T;
  }
  return value;
}
