import {createStepId, createUniqueId, slugifyIdPart} from './ids.js';

export type IrIdRuleReference = Readonly<{
  rule: string;
  input: string;
  generatedId: string;
  owner: string;
  notes: string;
}>;

export type IrNormalizationRuleReference = Readonly<{
  concept: string;
  surfaceInput: string;
  irBehavior: string;
  owner: string;
}>;

const idOwner = 'libs/api/workflow-language/src/core/ir/ids.ts';
const normalizerOwner = 'libs/api/workflow-language/src/core/ir/normalize-surface-document.ts';
const expressionOwner = 'libs/api/workflow-language/src/core/ir/expression-ir.ts';
const trimLowercaseExample = ' Build Main ';
const separatorExample = 'build_main/main';
const fallbackExample = '!!!';
const collisionExample = 'build-main';
const stepNameExample = 'Install deps';
const anonymousStepRunExample = 'pnpm install';

export const irIdRuleReference: readonly IrIdRuleReference[] = [
  {
    rule: 'Trim and lowercase ID parts',
    input: `\`"${trimLowercaseExample}"\``,
    generatedId: slugifyIdPart(trimLowercaseExample),
    owner: idOwner,
    notes: 'Used for workflow, trigger, job, and step ID parts.',
  },
  {
    rule: 'Replace non-alphanumeric runs with one hyphen',
    input: `\`"${separatorExample}"\``,
    generatedId: slugifyIdPart(separatorExample),
    owner: idOwner,
    notes: 'Underscores, spaces, slashes, and other punctuation are separators.',
  },
  {
    rule: 'Strip edge hyphens and fall back to `item`',
    input: `\`"${fallbackExample}"\``,
    generatedId: slugifyIdPart(fallbackExample),
    owner: idOwner,
    notes: 'The fallback keeps every IR entity addressable after slugification.',
  },
  {
    rule: 'Append numeric suffixes for collisions',
    input: `\`base = "${collisionExample}"\`, used IDs contain \`${collisionExample}\``,
    generatedId: createUniqueId(collisionExample, new Set([collisionExample])),
    owner: idOwner,
    notes: 'Suffixes start at `-2` and advance until the ID is unused.',
  },
  {
    rule: 'Prefer explicit step names over run commands',
    input: `\`jobId = "build"\`, \`name = "${stepNameExample}"\`, \`run = "${anonymousStepRunExample}"\``,
    generatedId: createStepId({
      jobId: 'build',
      stepName: stepNameExample,
      run: anonymousStepRunExample,
      usedStepIds: new Set(),
    }),
    owner: idOwner,
    notes: 'A named step keeps a stable semantic ID even if its command changes.',
  },
  {
    rule: 'Use run commands for anonymous step IDs',
    input: `\`jobId = "build"\`, \`run = "${anonymousStepRunExample}"\``,
    generatedId: createStepId({
      jobId: 'build',
      run: anonymousStepRunExample,
      usedStepIds: new Set(),
    }),
    owner: idOwner,
    notes: 'Anonymous steps are still collision-safe within the workflow.',
  },
];

export const irNormalizationRuleReference: readonly IrNormalizationRuleReference[] = [
  {
    concept: 'Workflow identity',
    surfaceInput: '`name`',
    irBehavior:
      '`WorkflowIR.id` is slugified from the workflow name; `WorkflowIR.name` preserves the original name.',
    owner: normalizerOwner,
  },
  {
    concept: 'Trigger map ordering',
    surfaceInput: '`triggers` map keys',
    irBehavior:
      'Trigger names are sorted before assigning collision-safe IDs and emitting `TriggerIR[]`.',
    owner: normalizerOwner,
  },
  {
    concept: 'Job map ordering',
    surfaceInput: '`jobs` map keys',
    irBehavior:
      'Job names are sorted before assigning collision-safe IDs and emitting deterministic `JobIR[]`.',
    owner: normalizerOwner,
  },
  {
    concept: 'Authored job order',
    surfaceInput: '`jobs` map key insertion order',
    irBehavior:
      '`JobIR.position` preserves authored order while `JobIR.sourceName` preserves the authored key.',
    owner: normalizerOwner,
  },
  {
    concept: 'Dependency edges',
    surfaceInput: 'job `needs`',
    irBehavior:
      'Dependencies emit prerequisite-to-dependent edges as `{from, to}` and sort by `from` then `to`.',
    owner: normalizerOwner,
  },
  {
    concept: 'Unresolved dependencies',
    surfaceInput: 'job `needs` entry with no matching job key',
    irBehavior:
      'The unresolved surface reference is preserved for static semantics instead of being slugified.',
    owner: normalizerOwner,
  },
  {
    concept: 'Runner selector',
    surfaceInput: 'workflow or job `runner` string or string array',
    irBehavior:
      'Strings normalize to a single-item selector, arrays pass through, and omitted selectors become `null`.',
    owner: normalizerOwner,
  },
  {
    concept: 'Run steps',
    surfaceInput: 'job `steps[].run`',
    irBehavior:
      'Run steps flatten into workflow-level `StepIR[]` and job-local `StepId[]` references.',
    owner: normalizerOwner,
  },
  {
    concept: 'Default acceptance',
    surfaceInput: 'run step without custom gate expression',
    irBehavior: `Each run step receives the typed \`default_run_exit_code\` acceptance policy from \`${expressionOwner}\`.`,
    owner: normalizerOwner,
  },
];
