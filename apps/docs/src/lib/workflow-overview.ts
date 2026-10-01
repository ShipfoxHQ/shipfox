import {type TemplateIcon, templateIconLabels} from './template-catalog/types';

// Text of the introduction diagram. The component draws it, and screen readers and the
// machine-readable export read the same facts as sentences.

export type WorkflowStepKind = 'agent' | 'tool' | 'run';

export interface WorkflowStep {
  kind: WorkflowStepKind;
  title: string;
  model?: string;
  /** Illustrative model cost for one run of the step, in dollars. */
  cost?: string;
  scope?: {provider?: TemplateIcon; label: string};
  /** Index of the earlier step this one sends work back to when it fails. */
  loopsTo?: number;
}

export const workflowTriggerBrands: TemplateIcon[] = [
  'linear',
  'github',
  'slack',
  'jira',
  'sentry',
  'posthog',
  'notion',
  'clickup',
];

export const workflowFile = {directory: '.shipfox/workflows/', name: 'implement-issue.yml'};
export const workflowRunner = 'isolated, ephemeral runner';

export const workflowSteps: WorkflowStep[] = [
  {
    kind: 'agent',
    title: 'Triage',
    model: 'GLM 5.3',
    cost: '$0.01',
    scope: {provider: 'linear', label: 'reads Linear'},
  },
  {kind: 'tool', title: 'Mark in progress', scope: {provider: 'linear', label: 'writes Linear'}},
  {
    kind: 'agent',
    title: 'Fix issues',
    model: 'GPT-6 Sol',
    cost: '$0.12',
    scope: {label: 'edits code'},
  },
  {kind: 'run', title: 'npm test', loopsTo: 2},
  {
    kind: 'agent',
    title: 'Open PR',
    model: 'Claude Sonnet',
    cost: '$0.03',
    scope: {provider: 'github', label: 'writes GitHub'},
  },
];

export const exampleRun = {number: 128, duration: '4m 12s', cost: '$0.16'};

export const reviewChecks = [
  'Tests passing',
  'Summary of changes',
  'Small and focused',
  'Ready for review',
] as const;

export const otherResults = ['Diagnosis', 'Suggested improvement'] as const;

export const resumeLabel = ['Comment, even days later', 'resumes with full context'] as const;

export function describeWorkflowStep(step: WorkflowStep): string {
  const facts = [step.model ? `${step.kind} step on ${step.model}` : `${step.kind} step`];
  if (step.scope) facts.push(step.scope.label);
  if (step.cost) facts.push(`costs about ${step.cost}`);
  const loop =
    step.loopsTo === undefined
      ? ''
      : ` If it fails, the workflow goes back to ${workflowSteps[step.loopsTo]?.title}.`;
  return `${step.title}: ${facts.join(', ')}.${loop}`;
}

export const workflowTriggersDescription = `${[...workflowTriggerBrands.map((brand) => templateIconLabels[brand]), 'a schedule', 'or a webhook'].join(', ')} start the workflow, from a ticket, a pull request, an alert, a check, or a schedule.`;

export const exampleRunDescription = `Example run #${exampleRun.number} succeeded in ${exampleRun.duration}, cost about ${exampleRun.cost}, and recorded logs, the agent session, and metrics.`;

export const handoffDescription =
  'The Open PR step sends the result to your team. A comment on it, even days later, resumes the Fix issues step with full context.';

export const teamDescription =
  'Your team gets a pull request marked ready, with tests passing, a summary of changes, and a small, focused change ready for review. Other workflows return a diagnosis or a suggested improvement instead.';

export function serializeWorkflowOverview(): string {
  return [
    'How a Shipfox workflow runs:',
    '',
    `1. Triggers: ${workflowTriggersDescription}`,
    `2. Agent workflow: defined in \`${workflowFile.directory}${workflowFile.name}\` and run on an ${workflowRunner}.`,
    ...workflowSteps.map((step) => `   - ${describeWorkflowStep(step)}`),
    `   - ${exampleRunDescription}`,
    `3. Your team: ${handoffDescription} ${teamDescription}`,
  ].join('\n');
}
