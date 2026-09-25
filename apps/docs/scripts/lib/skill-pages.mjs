import {posix} from 'node:path';
import {inlineCode, tableValue} from '@/lib/markdown';

/**
 * The docs page for every shipped skill. The docs own the URL
 * and page metadata; the body comes from the skill's SKILL.md. Generation fails
 * when a shipped skill has no entry here or an entry names a missing skill.
 */
export const SKILL_PAGES = [
  {
    skill: 'write-a-workflow',
    path: 'how-to/author-workflows/write-a-workflow',
    title: 'Write a Workflow With a Coding Agent',
    sidebarTitle: 'Write a Workflow With an Agent',
    description:
      "Have a coding agent turn a goal into workflow YAML from your workspace's connections, models, and events.",
  },
  {
    skill: 'create-workflow-from-template',
    path: 'how-to/author-workflows/create-workflow-from-template',
    title: 'Create a Workflow From a Template',
    sidebarTitle: 'Start From a Template',
    description:
      'Have a coding agent adapt a Shipfox workflow template to your repository and test it before you push.',
  },
  {
    skill: 'validate-workflow-change',
    path: 'how-to/run-and-troubleshoot/validate-local-workflow-change',
    title: 'Validate a Workflow Before You Push',
    sidebarTitle: 'Validate Unpushed YAML',
    description:
      'Use a coding agent to check unpushed workflow YAML and trigger eligibility without starting a run.',
  },
  {
    skill: 'test-workflow-change',
    path: 'how-to/run-and-troubleshoot/test-local-workflow-change',
    title: 'Run a Workflow Before You Push',
    sidebarTitle: 'Run Unpushed YAML',
    description:
      'Use a coding agent to run validated, unpushed workflow YAML against a retained event and inspect the result.',
  },
  {
    skill: 'debug-a-failed-run',
    path: 'how-to/run-and-troubleshoot/debug-failed-run',
    title: 'Debug a Failed Run With a Coding Agent',
    sidebarTitle: 'Debug a Run With an Agent',
    description:
      'Have a coding agent trace a failed run to its first error, or find why an event did not start one.',
  },
];

const SKILL_FILE_SUFFIX = '/SKILL.md';
const FRONTMATTER_PATTERN = /^---\n[\s\S]*?\n---\n/;
const LEADING_TITLE_PATTERN = /^\s*# [^\n]+\n+/;
const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})/;
const CODE_SPAN_PATTERN = /(`[^`\n]+`)/;
const MARKDOWN_LINK_PATTERN = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
const SITE_LINK_PATTERN = /^[/#]/;
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;
const SKILL_URI_PATTERN = /^skill:\/\/shipfox\/([^/]+)\/SKILL\.md$/;
const DOCS_URI_PATTERN = /^docs:\/\/shipfox\/([a-z0-9][a-z0-9/-]*)$/;
const DOCS_URL_PATTERN = /^https:\/\/www\.shipfox\.io\/docs(\/[^#?]*?)?(?:\.md)?([#?].*)?$/;
const MDX_SYNTAX_PATTERN = /[<{]/g;

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

export function renderSkillPage(entry, entries) {
  const {skill, resource} = entry;
  return [
    frontmatter(entry),
    '',
    `This page shows the \`${skill}\` skill that the [Shipfox MCP server](/reference/mcp-server#resources)`,
    'serves to coding agents. To have your agent follow it, [connect the',
    'agent](/how-to/set-up-work/connect-mcp-client) and paste this prompt:',
    '',
    '```text',
    resource.catalogPrompt,
    '```',
    '',
    'The procedure below is written for the agent.',
    '',
    skillMarkdownToMdx(resource.text, {skill, routes: skillRoutes(entries)}),
    '',
  ].join('\n');
}

export function renderSkillResourceTable(resources, entries) {
  const routes = skillRoutes(entries);
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

/**
 * Turns a SKILL.md file into an MDX page body. Skill and docs URIs become links
 * to their docs pages, relative links resolve against the skill directory, and
 * MDX syntax characters in prose are escaped so the text renders as written.
 */
export function skillMarkdownToMdx(markdown, {skill, routes}) {
  const body = markdown.replace(FRONTMATTER_PATTERN, '').replace(LEADING_TITLE_PATTERN, '');
  let fence;
  return body
    .trim()
    .split('\n')
    .map((line) => {
      const marker = line.match(FENCE_PATTERN)?.[1];
      if (marker && (!fence || (marker[0] === fence[0] && marker.length >= fence.length))) {
        fence = fence ? undefined : marker;
        return line;
      }
      if (fence) return line;
      return rewriteLinks(line, {skill, routes})
        .split(CODE_SPAN_PATTERN)
        .map((segment, index) =>
          index % 2 === 1
            ? rewriteCodeSpan(segment, routes)
            : segment.replace(MDX_SYNTAX_PATTERN, '\\$&'),
        )
        .join('');
    })
    .join('\n');
}

function rewriteLinks(line, {skill, routes}) {
  return line.replace(MARKDOWN_LINK_PATTERN, (link, text, destination) => {
    const docsUrl = destination.match(DOCS_URL_PATTERN);
    if (docsUrl) return `[${text}](${docsUrl[1] || '/'}${docsUrl[2] ?? ''})`;
    if (SCHEME_PATTERN.test(destination) || SITE_LINK_PATTERN.test(destination)) return link;

    const uri = `skill://shipfox/${posix.normalize(posix.join(skill, destination))}`;
    const route = routes.get(uri.match(SKILL_URI_PATTERN)?.[1]);
    return route ? `[${text}](${route})` : `${text} (\`${uri}\`)`;
  });
}

function rewriteCodeSpan(codeSpan, routes) {
  const value = codeSpan.slice(1, -1);
  const route = routes.get(value.match(SKILL_URI_PATTERN)?.[1]);
  if (route) return `[${codeSpan}](${route})`;
  const docsSlug = value.match(DOCS_URI_PATTERN)?.[1];
  if (docsSlug && docsSlug !== 'index') {
    return `[${codeSpan}](/${docsSlug === 'home' ? '' : docsSlug})`;
  }
  return codeSpan;
}

function skillRoutes(entries) {
  return new Map(entries.map((entry) => [entry.skill, `/${entry.path}`]));
}

function frontmatter({title, sidebarTitle, description}) {
  return [
    '---',
    `title: ${JSON.stringify(title)}`,
    `sidebarTitle: ${JSON.stringify(sidebarTitle)}`,
    `description: ${JSON.stringify(description)}`,
    '---',
  ].join('\n');
}
