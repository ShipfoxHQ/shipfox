import {buildTemplatePrompt, FIRST_WORKFLOW_PROMPT} from '@shipfox/workflow-templates/prompt';

const TEMPLATE_PREFIX = 'template:';
const GENERIC_PROMPT = 'generic';
// The docs page names providers the way people read them, so the prompt does too.
const PROVIDER_LABELS: Record<string, string> = {
  clickup: 'ClickUp',
  discord: 'Discord',
  github: 'GitHub',
  jira: 'Jira',
  linear: 'Linear',
  notion: 'Notion',
  posthog: 'PostHog',
  slack: 'Slack',
};
const NO_PROVIDER = 'none';

function choiceClause({role, provider}: {role: string; provider: string}): string {
  if (provider === NO_PROVIDER) return `without the ${role} part`;
  return `with ${PROVIDER_LABELS[provider] ?? provider} as the ${role}`;
}

/**
 * The prompt the agent receives, built by the product's own prompt builders. `template:<id>`
 * takes the role choices from its query string, as the docs page does when a reader picks
 * providers: `template:ticket-to-pr?tracker=linear` or `?report=none`. `generic` is the prompt of
 * the first-workflow panel. Any other value is the literal prompt.
 */
export function resolvePrompt(prompt: string): string {
  if (prompt === GENERIC_PROMPT) return FIRST_WORKFLOW_PROMPT;
  if (!prompt.startsWith(TEMPLATE_PREFIX)) return prompt;

  const [templateId = '', query = ''] = prompt.slice(TEMPLATE_PREFIX.length).split('?');
  const choices = [...new URLSearchParams(query)].map(([role, provider]) =>
    choiceClause({role, provider}),
  );
  return buildTemplatePrompt({templateId, choices});
}
