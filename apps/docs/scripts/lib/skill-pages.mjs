import {inlineCode, tableValue} from '@/lib/markdown';

/**
 * The docs page for every skill the Shipfox MCP server serves. The docs own the
 * URL and the reader-facing prose; the prompt comes from the skill's
 * `catalog_prompt`. Generation fails when a shipped skill has no entry here or
 * an entry names a missing skill.
 */
export const SKILL_PAGES = [
  {
    skill: 'write-a-workflow',
    path: 'how-to/author-workflows/write-a-workflow',
    title: 'Write a Workflow With a Coding Agent',
    sidebarTitle: 'Write a Workflow',
    description:
      'Describe what to automate and let your coding agent write, check, and test the workflow file.',
    intro: [
      'Describe what you want to automate and let your coding agent write the',
      'workflow file. The agent reads your repository and your Shipfox workspace',
      'for integration connections, models, runners, and real events. It asks you',
      'to confirm choices such as the model, then checks and tests the file before',
      'you commit it.',
    ],
    prerequisites: ['A Shipfox project with the repository configured.'],
  },
  {
    skill: 'create-workflow-from-template',
    path: 'how-to/author-workflows/create-workflow-from-template',
    title: 'Create a Workflow From a Template',
    sidebarTitle: 'Start From a Template',
    description:
      'Let your coding agent adapt a Shipfox workflow template to your repository and test it before you push.',
    intro: [
      'Start from a Shipfox workflow template instead of a blank file. Your coding',
      'agent suggests the templates that fit your integration connections and asks',
      'one set of questions. It then adapts the template to your repository and',
      'tests it before you commit it.',
    ],
    prerequisites: [
      'A Shipfox project with the repository configured.',
      'An integration connection for each provider the template uses, such as GitHub or Linear.',
    ],
  },
  {
    skill: 'validate-workflow-change',
    path: 'how-to/run-and-troubleshoot/validate-local-workflow-change',
    title: 'Validate a Workflow Before You Push',
    sidebarTitle: 'Validate Unpushed YAML',
    description:
      'Use a coding agent to check unpushed workflow YAML and trigger eligibility without starting a run.',
    intro: [
      'Check unpushed workflow YAML before you start a run. Your coding agent sends',
      'the file from your working tree to Shipfox. It reports whether the',
      'definition is valid and whether the trigger accepts a matching event.',
      'Nothing runs and no external resource changes.',
    ],
    prerequisites: [
      'A Shipfox project with the repository configured.',
      'The workflow YAML file in your working tree.',
      'For an integration trigger, a matching event received within the last 30 days. Without one, the agent checks only the shape of the workflow.',
    ],
  },
  {
    skill: 'test-workflow-change',
    path: 'how-to/run-and-troubleshoot/test-local-workflow-change',
    title: 'Run a Workflow Before You Push',
    sidebarTitle: 'Run Unpushed YAML',
    description:
      'Use a coding agent to run validated, unpushed workflow YAML against a real event and inspect the result.',
    intro: [
      'Run unpushed workflow YAML against a real event before you push it. Your',
      'coding agent validates the file, starts a run, follows it, and reads the',
      'logs when it fails.',
      '',
      'The run acts on real resources. It can comment on the original issue or pull',
      'request and run code with workspace secrets. The agent tells you what it',
      'expects to change and waits for your approval before it starts the run.',
      '',
      'Only the YAML file is uploaded. Commit and push the scripts and prompt files',
      'it depends on first.',
    ],
    prerequisites: [
      'A Shipfox project with its repository, integration connections, runners, and secrets configured.',
      'The workflow YAML file in your working tree.',
    ],
  },
  {
    skill: 'debug-a-failed-run',
    path: 'how-to/run-and-troubleshoot/debug-failed-run',
    title: 'Debug a Failed Run With a Coding Agent',
    sidebarTitle: 'Debug a Failed Run',
    description:
      'Let your coding agent trace a failed run to its first error, or find why an event did not start one.',
    intro: [
      'Find why a workflow run failed or why an event did not start one. Your',
      'coding agent traces the run through its jobs, steps, and logs. It reports',
      'the first error, its likely cause, and one fix to try.',
    ],
    prerequisites: [
      'A link to the failed run, or a description of the event that did not start one.',
    ],
  },
];

const SKILL_FILE_SUFFIX = '/SKILL.md';

/**
 * Pairs each shipped SKILL.md resource with its docs page.
 */
export function skillPageEntries(resources, pages = SKILL_PAGES) {
  const skills = new Map(
    resources
      .filter((resource) => resource.name.endsWith(SKILL_FILE_SUFFIX))
      .map((resource) => [resource.name.slice(0, -SKILL_FILE_SUFFIX.length), resource]),
  );
  const pagesBySkill = new Map(pages.map((page) => [page.skill, page]));
  const unmapped = [...skills.keys()].filter((skill) => !pagesBySkill.has(skill));
  if (unmapped.length > 0) {
    throw new Error(`Skills without a docs page in SKILL_PAGES: ${unmapped.join(', ')}`);
  }
  const missing = pages.filter((page) => !skills.has(page.skill)).map((page) => page.skill);
  if (missing.length > 0) {
    throw new Error(`SKILL_PAGES names skills that are not shipped: ${missing.join(', ')}`);
  }
  return pages.map((page) => ({...page, resource: skills.get(page.skill)}));
}

export function renderSkillPage({
  title,
  sidebarTitle,
  description,
  intro,
  prerequisites,
  resource,
}) {
  return [
    '---',
    `title: ${JSON.stringify(title)}`,
    `sidebarTitle: ${JSON.stringify(sidebarTitle)}`,
    `description: ${JSON.stringify(description)}`,
    '---',
    '',
    ...intro,
    '',
    'This guide is meant to be carried out by your coding agent. You start it with',
    "one prompt, answer the agent's questions, and review what it reports.",
    '',
    '## Before you begin',
    '',
    'You need:',
    '',
    '- A coding agent [connected to the Shipfox MCP',
    '  server](/how-to/set-up-work/connect-mcp-client).',
    ...prerequisites.map((prerequisite) => `- ${prerequisite}`),
    '',
    '## Start the agent',
    '',
    'Open your coding agent in your repository and send this prompt:',
    '',
    '```text',
    resource.catalogPrompt,
    '```',
    '',
  ].join('\n');
}

export function renderSkillResourceTable(resources, entries) {
  const routes = new Map(entries.map((entry) => [entry.skill, `/${entry.path}`]));
  return [
    '| Resource | Title | Description |',
    '|---|---|---|',
    ...resources.map((resource) => {
      const route = routes.get(resource.name.slice(0, -SKILL_FILE_SUFFIX.length));
      const title = resource.name.endsWith(SKILL_FILE_SUFFIX)
        ? `[${resource.title}](${route})`
        : resource.title;
      return `| ${inlineCode(resource.uri)} | ${tableValue(title)} | ${tableValue(resource.description)} |`;
    }),
  ].join('\n');
}
