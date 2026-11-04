import {readFile} from 'node:fs/promises';
import {parse as parseYaml} from 'yaml';
import {z} from 'zod';
import {CaseValidationError, formatValidationIssues} from './schema.js';

const NAME = /^[a-z][a-z0-9_]*$/u;
const RUN_REFERENCE = /\$runs\.([a-z][a-z0-9_]*)/gu;

function isPattern(value: string): boolean {
  try {
    new RegExp(value, 'iu');
    return true;
  } catch {
    return false;
  }
}

const patternSchema = z.string().min(1).refine(isPattern, 'Not a valid regular expression.');

/** A run the case starts before the conversation, so Shippy has something real to read. */
const seededRunSchema = z
  .object({
    name: z.string().regex(NAME, 'A run name is lowercase letters, digits, and underscores.'),
    workflow: z.string().min(1),
    status: z.enum(['succeeded', 'failed']),
  })
  .strict();

/**
 * One message the user sends. `page_context` is sent as the chat panel sends it, and a string
 * value `$runs.<name>` becomes the ID of that seeded run.
 */
const messageSchema = z
  .object({
    body: z.string().min(1),
    page_context: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  })
  .strict();

/**
 * What a correct reply does. Patterns are case-insensitive regular expressions on the final
 * reply. `$runs.<name>` in `tool_input_contains` becomes the ID of that seeded run.
 */
const expectSchema = z
  .object({
    tools_called: z.array(z.string().min(1)).default([]),
    tools_not_called: z.array(z.string().min(1)).default([]),
    tool_input_contains: z.array(z.string().min(1)).default([]),
    reply_matches: z.array(patternSchema).default([]),
    reply_not_matches: z.array(patternSchema).default([]),
    /** No run starts in the project during the conversation. */
    no_new_runs: z.boolean().default(false),
  })
  .strict();

export type ShippyExpect = z.infer<typeof expectSchema>;

/** The Shippy case format: seeded workflows and runs, the messages, and the expected reply. */
export const shippyCaseSchema = z
  .object({
    description: z.string().min(1),
    /** Workflow files next to `case.yaml`, by name. Each gets `runner: shipfox`. */
    workflows: z.record(z.string().regex(NAME), z.string().min(1)).default({}),
    runs: z.array(seededRunSchema).default([]),
    messages: z.array(messageSchema).min(1),
    expect: expectSchema,
    k: z.number().int().positive().default(3),
    timeout_seconds: z.number().int().positive().default(600),
  })
  .strict()
  .superRefine((value, context) => {
    const runNames = new Set<string>();
    for (const [index, run] of value.runs.entries()) {
      if (runNames.has(run.name)) {
        context.addIssue({
          code: 'custom',
          path: ['runs', index, 'name'],
          message: `Another run is already named "${run.name}".`,
        });
      }
      runNames.add(run.name);
      if (Object.hasOwn(value.workflows, run.workflow)) continue;
      context.addIssue({
        code: 'custom',
        path: ['runs', index, 'workflow'],
        message: `"${run.workflow}" is not one of the case's workflows.`,
      });
    }
    // A bad reference would otherwise fail only after the paid conversation.
    const references: Array<{path: Array<string | number>; text: string}> = [
      ...value.messages.flatMap((message, index) =>
        Object.entries(message.page_context ?? {}).flatMap(([key, entry]) =>
          typeof entry === 'string'
            ? [{path: ['messages', index, 'page_context', key], text: entry}]
            : [],
        ),
      ),
      ...value.expect.tool_input_contains.map((text, index) => ({
        path: ['expect', 'tool_input_contains', index],
        text,
      })),
    ];
    for (const {path, text} of references) {
      for (const [, name] of text.matchAll(RUN_REFERENCE)) {
        if (name === undefined || runNames.has(name)) continue;
        context.addIssue({code: 'custom', path, message: `The case seeds no run named "${name}".`});
      }
    }
  });

export type ShippyCase = z.infer<typeof shippyCaseSchema>;

export function parseShippyCase(value: unknown, casePath = 'case.yaml'): ShippyCase {
  const result = shippyCaseSchema.safeParse(value);
  if (!result.success) {
    throw new CaseValidationError(casePath, formatValidationIssues(result.error));
  }
  return result.data;
}

export async function loadShippyCase(casePath: string): Promise<ShippyCase> {
  let document: unknown;
  try {
    document = parseYaml(await readFile(casePath, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CaseValidationError(casePath, `could not parse YAML: ${message}`);
  }
  return parseShippyCase(document, casePath);
}

/** Replaces each `$runs.<name>` with the seeded run's ID. An unknown name is an error. */
export function resolveRunReferences(value: string, runIds: ReadonlyMap<string, string>): string {
  return value.replace(RUN_REFERENCE, (_match, name: string) => {
    const runId = runIds.get(name);
    if (runId === undefined) throw new Error(`The case seeds no run named "${name}".`);
    return runId;
  });
}
