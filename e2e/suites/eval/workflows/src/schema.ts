import {readFile} from 'node:fs/promises';
import {parse as parseYaml} from 'yaml';
import {z} from 'zod';

const bindingsSchema = z.record(z.string().min(1), z.string().min(1));
const optionsSchema = z.record(z.string().min(1), z.unknown());
const slotsSchema = z.record(z.string().min(1), z.string());
// A placeholder the coding agent edits in the composed file, such as `replace-with-team-key`.
const placeholdersSchema = z.record(z.string().regex(/^replace-with-[A-Za-z0-9/-]+$/u), z.string());
const stepTimeoutSchema = z.number().int().positive().optional();
// One provider and one event, as in `github: {pull_request.closed: {...}}`.
const eventSchema = z
  .record(z.string().min(1), z.record(z.string().min(1), z.record(z.string(), z.unknown())))
  .refine(
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
      start: z
        .object({
          manual: z.object({inputs: z.record(z.string(), z.unknown()).default({})}).strict(),
        })
        .strict(),
      timeout_seconds: stepTimeoutSchema,
    })
    .strict(),
  z
    .object({start: z.object({event: eventSchema}).strict(), timeout_seconds: stepTimeoutSchema})
    .strict(),
  // The case's own workflow starts on an event that a fired workflow raised, such as `run.completed`.
  z
    .object({
      start: z.object({triggered: z.literal(true)}).strict(),
      timeout_seconds: stepTimeoutSchema,
    })
    .strict(),
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

const linearIssueSeedSchema = z
  .object({
    id: z.string().min(1),
    identifier: z.string().min(1),
    title: z.string().min(1),
    description: z.string().optional(),
    // The team key, such as `ENG`.
    team: z.string().min(1),
    // Label names the issue has before any scenario event.
    labels: z.array(z.string().min(1)).default([]),
  })
  .strict();

const slackMessageSeedSchema = z
  .object({
    ts: z.string().min(1),
    user: z.string().min(1),
    text: z.string(),
    thread_ts: z.string().min(1).optional(),
  })
  .strict();

// A pull request the GitHub fake holds before the scenario starts, such as a dependency update.
const seedPullRequestSchema = z
  .object({
    branch: z.string().min(1),
    author: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    // A directory of files, relative to the case directory, laid over `repo/` as the branch's tree.
    files: z.string().min(1).optional(),
  })
  .strict();

// What the provider fakes serve before the scenario starts.
const seedSchema = z
  .object({
    pull_requests: z.array(seedPullRequestSchema).default([]),
    linear: z
      .object({
        issues: z
          .array(linearIssueSeedSchema)
          .min(1)
          .refine(
            (issues) => new Set(issues.map(({identifier}) => identifier)).size === issues.length,
            {message: 'issue identifiers must be unique'},
          ),
      })
      .strict()
      .optional(),
    slack: z
      .object({
        // The channel the thread is in, which the workflow's trigger filter must list.
        channel: z.string().min(1),
        // The thread the Slack fake serves, oldest first. The parent message comes first.
        thread: z.array(slackMessageSeedSchema).min(1),
      })
      .strict()
      .optional(),
  })
  .strict();

export type LinearIssueSeed = z.infer<typeof linearIssueSeedSchema>;
export type SlackSeed = NonNullable<z.infer<typeof seedSchema>['slack']>;
export type SeedPullRequest = z.infer<typeof seedPullRequestSchema>;

// Fires the manual trigger of one of the case's `workflows` and waits for that run to end with
// the status given. The run it starts is not the one the case observes.
const fireStepSchema = z
  .object({
    fire: z
      .object({
        workflow: z.string().min(1),
        inputs: z.record(z.string(), z.unknown()).default({}),
        status: runStatusSchema,
      })
      .strict(),
    timeout_seconds: stepTimeoutSchema,
  })
  .strict();

const scenarioStepSchema = z.union([
  startStepSchema,
  sendStepSchema,
  awaitStepSchema,
  fireStepSchema,
]);

export type ScenarioStep = z.infer<typeof scenarioStepSchema>;

// One kind of write, as in `github.push: {branch: $pr.head, count: 2}`. The other fields are
// matched against the write, so `count: 0` states a write that must not happen.
const writeExpectationSchema = z
  .record(
    z.string().min(1),
    z.object({count: z.number().int().nonnegative().default(1)}).passthrough(),
  )
  .refine((expectation) => Object.keys(expectation).length === 1, {
    message: 'must name exactly one kind of write',
  });
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
    placeholders: placeholdersSchema.default({}),
    seed: seedSchema.default({pull_requests: []}),
    modes: z
      .array(z.enum(['scripted', 'live']))
      .min(1)
      .default(['scripted']),
    repository: z.string().min(1).optional(),
    // Other workflows of the project by name, as files next to the case, for `fire` steps.
    workflows: z.record(z.string().min(1), z.string().min(1)).default({}),
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
