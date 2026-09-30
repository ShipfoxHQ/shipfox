import {readFile} from 'node:fs/promises';
import {parse as parseYaml} from 'yaml';
import {z} from 'zod';
import {CaseValidationError, formatValidationIssues} from './schema.js';

/** Providers an onboarding workspace can hold a connection to, each backed by a fake. */
export const ONBOARDING_PROVIDERS = ['github', 'linear'] as const;

const TEMPLATE_PROMPT_PATTERN =
  /^template:[a-z0-9][a-z0-9-]*(\?[a-z0-9_-]+=[a-z0-9_-]+(&[a-z0-9_-]+=[a-z0-9_-]+)*)?$/u;

const promptSchema = z
  .string()
  .min(1)
  .refine(
    (value) => !value.startsWith('template:') || TEMPLATE_PROMPT_PATTERN.test(value),
    'A template prompt reads `template:<id>`, optionally followed by `?role=provider&role=none`.',
  );

const workspaceSchema = z
  .object({
    connections: z.array(z.enum(ONBOARDING_PROVIDERS)).default([]),
    project: z
      .object({
        repository: z
          .string()
          .regex(/^[^/\s]+\/[^/\s]+$/u, 'The repository must read `owner/name`.'),
      })
      .strict(),
  })
  .strict()
  .refine(
    (workspace) => workspace.connections.includes('github'),
    'A project needs the `github` connection, because the fixture repository is served by the GitHub fake.',
  );

/** What a correct agent ends with. Each outcome has its own checks. */
export const ONBOARDING_OUTCOMES = [
  'validated',
  'blocked_on_connection',
  'needs_clarification',
] as const;

export type OnboardingOutcome = (typeof ONBOARDING_OUTCOMES)[number];

const TEMPLATE_PACKAGE_PATTERN = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/u;

const expectSchema = z
  .object({
    outcome: z.enum(ONBOARDING_OUTCOMES),
    /** The registry package the written workflow must come from, such as `shipfox/ticket-to-pr`. */
    template: z
      .string()
      .regex(TEMPLATE_PACKAGE_PATTERN, 'A template reads `namespace/name`.')
      .optional(),
    /** The role bindings the header must record. */
    bindings: z.record(z.string().min(1), z.string().min(1)).optional(),
    /** The option choices the case settles. Every other option takes its manifest default. */
    options: z.record(z.string().min(1), z.string().min(1)).optional(),
    /** The provider a `blocked_on_connection` agent must tell the user to connect. */
    missing_provider: z.string().min(1).optional(),
    max_questions: z.number().int().nonnegative().optional(),
  })
  .strict()
  .superRefine((expected, context) => {
    const issue = (path: string, message: string) =>
      context.addIssue({code: 'custom', path: [path], message});
    if (expected.template !== undefined && expected.outcome !== 'validated') {
      issue('template', 'Only a `validated` outcome writes a workflow to compare with a template.');
    }
    if (expected.template === undefined) {
      if (expected.bindings !== undefined) issue('bindings', 'Bindings need a `template`.');
      if (expected.options !== undefined) issue('options', 'Options need a `template`.');
    }
    if (expected.outcome === 'blocked_on_connection' && expected.missing_provider === undefined) {
      issue('missing_provider', 'A `blocked_on_connection` outcome names the provider to connect.');
    }
    if (expected.outcome !== 'blocked_on_connection' && expected.missing_provider !== undefined) {
      issue('missing_provider', 'Only a `blocked_on_connection` outcome names a missing provider.');
    }
  });

export type OnboardingExpect = z.infer<typeof expectSchema>;

/** The onboarding case format. `expect` and `judges` are read by the graders, not the driver. */
export const onboardingCaseSchema = z
  .object({
    prompt: promptSchema,
    workspace: workspaceSchema,
    persona: z.string().min(1),
    k: z.number().int().positive().default(3),
    max_turns: z.number().int().positive().default(40),
    timeout_seconds: z.number().int().positive().default(1200),
    expect: expectSchema,
    judges: z.array(z.string().min(1)).default([]),
    quarantined: z.union([z.string().min(1), z.literal(false)]).optional(),
  })
  .strict();

export type OnboardingCase = z.infer<typeof onboardingCaseSchema>;

export function parseOnboardingCase(value: unknown, casePath = 'case.yaml'): OnboardingCase {
  const result = onboardingCaseSchema.safeParse(value);
  if (!result.success) {
    throw new CaseValidationError(casePath, formatValidationIssues(result.error));
  }
  return result.data;
}

export async function loadOnboardingCase(casePath: string): Promise<OnboardingCase> {
  let document: unknown;
  try {
    document = parseYaml(await readFile(casePath, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CaseValidationError(casePath, `could not parse YAML: ${message}`);
  }
  return parseOnboardingCase(document, casePath);
}
