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

/** The onboarding case format. `expect` and `judges` are read by the graders, not the driver. */
export const onboardingCaseSchema = z
  .object({
    prompt: promptSchema,
    workspace: workspaceSchema,
    persona: z.string().min(1),
    k: z.number().int().positive().default(3),
    max_turns: z.number().int().positive().default(40),
    timeout_seconds: z.number().int().positive().default(1200),
    expect: z.record(z.string().min(1), z.unknown()).default({}),
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
