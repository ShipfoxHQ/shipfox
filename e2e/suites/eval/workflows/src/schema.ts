import {readFile} from 'node:fs/promises';
import {parse as parseYaml} from 'yaml';
import {z} from 'zod';

const bindingsSchema = z.record(z.string().min(1), z.string().min(1));
const optionsSchema = z.record(z.string().min(1), z.unknown());
const slotsSchema = z.record(z.string().min(1), z.string());
const stepTimeoutSchema = z.number().int().positive().optional();
// One provider and one event, as in `github: {pull_request.closed: {...}}`.
const eventSchema = z.record(z.string().min(1), z.record(z.string().min(1), z.unknown())).refine(
  (event) => {
    const providers = Object.values(event);
    return providers.length === 1 && Object.keys(providers[0] ?? {}).length === 1;
  },
  {message: 'must name exactly one provider and one event'},
);
const jobStatusSchema = z.enum([
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'skipped',
]);
const executionStatusSchema = z.enum(['pending', 'running', 'succeeded', 'failed', 'cancelled']);
const runStatusSchema = z.enum(['succeeded', 'failed', 'cancelled']);

const startStepSchema = z.union([
  z
    .object({
      start: z.object({manual: z.object({inputs: z.record(z.string(), z.unknown()).default({})})}),
      timeout_seconds: stepTimeoutSchema,
    })
    .strict(),
  z.object({start: z.object({event: eventSchema}), timeout_seconds: stepTimeoutSchema}).strict(),
]);

const sendStepSchema = z.object({send: eventSchema, timeout_seconds: stepTimeoutSchema}).strict();

const awaitStepSchema = z
  .object({
    await: z.union([
      z.object({job: z.string().min(1), status: jobStatusSchema}).strict(),
      z.object({listener: z.string().min(1), ready: z.literal(true)}).strict(),
      z
        .object({
          listener: z.string().min(1),
          execution: z.number().int().positive(),
          status: executionStatusSchema,
        })
        .strict(),
      z.object({run: runStatusSchema}).strict(),
    ]),
    timeout_seconds: stepTimeoutSchema,
  })
  .strict();

const scenarioStepSchema = z.union([startStepSchema, sendStepSchema, awaitStepSchema]);

export type ScenarioStep = z.infer<typeof scenarioStepSchema>;

const writeExpectationSchema = z.record(z.string().min(1), z.unknown());
const expectSchema = z
  .object({
    outputs: z.record(z.string().min(1), z.unknown()).optional(),
    writes: z.array(writeExpectationSchema).default([]),
  })
  .passthrough();

/** The v1 case format shared by scripted and live template evaluations. */
export const templateCaseSchema = z
  .object({
    template: z.string().min(1),
    bindings: bindingsSchema.default({}),
    options: optionsSchema.default({}),
    slots: slotsSchema.default({}),
    modes: z
      .array(z.enum(['scripted', 'live']))
      .min(1)
      .default(['scripted']),
    repository: z.string().min(1).optional(),
    // A catalog directory, relative to the case directory, for cases that run a fixture template.
    catalog: z.string().min(1).optional(),
    timeout_seconds: z.number().int().positive().default(900),
    scenario: z.array(scenarioStepSchema).min(1),
    expect: expectSchema,
    covers: z.array(z.string().min(1)).default([]),
    quarantined: z.union([z.string().min(1), z.literal(false)]).optional(),
    live: z
      .object({
        hidden_tests: z.string().min(1).optional(),
        judges: z.array(z.string().min(1)).default([]),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type TemplateCase = z.infer<typeof templateCaseSchema>;

export class CaseValidationError extends Error {
  readonly casePath: string;

  constructor(casePath: string, message: string) {
    super(`${casePath}: ${message}`);
    this.name = 'CaseValidationError';
    this.casePath = casePath;
  }
}

export function formatValidationIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length === 0 ? '<root>' : issue.path.join('.');
      return `${path}: ${issue.message}`;
    })
    .join('\n');
}

export function parseTemplateCase(value: unknown, casePath = 'case.yaml'): TemplateCase {
  const result = templateCaseSchema.safeParse(value);
  if (!result.success) {
    throw new CaseValidationError(casePath, formatValidationIssues(result.error));
  }
  return result.data;
}

export async function loadTemplateCase(casePath: string): Promise<TemplateCase> {
  let document: unknown;
  try {
    document = parseYaml(await readFile(casePath, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CaseValidationError(casePath, `could not parse YAML: ${message}`);
  }
  return parseTemplateCase(document, casePath);
}
