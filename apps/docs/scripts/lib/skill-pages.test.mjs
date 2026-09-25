import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {
  renderSkillPage,
  renderSkillResourceTable,
  skillMarkdownToMdx,
  skillPageEntries,
} from './skill-pages.mjs';

const UNMAPPED_SKILL_PATTERN = /Skills without a docs page in SKILL_PAGES: debug/;
const MISSING_SKILL_PATTERN = /SKILL_PAGES names skills that are not shipped: validate/;
const PAGE_FRONTMATTER_PATTERN = /^---\ntitle: "Debug It"\nsidebarTitle: "Debug"\n/;
const PAGE_PROMPT_PATTERN = /```text\nDebug my run\.\n```/;
const PAGE_BODY_PATTERN = /\n## debug body\n$/;
const INDEX_ROW_PATTERN = /^\| `skill:\/\/shipfox\/index` \| Skill index \| Find a skill\. \|$/m;
const SKILL_ROW_PATTERN = /\| \[debug title\]\(\/how-to\/debug\) \|/;
const REFERENCE_ROW_PATTERN = /\| `skill:\/\/shipfox\/debug\/references\/logs\.md` \| Logs \|/;
const pages = [
  {
    skill: 'validate',
    path: 'how-to/validate',
    title: 'Validate It',
    sidebarTitle: 'Validate',
    description: 'Validate a change.',
  },
  {
    skill: 'debug',
    path: 'how-to/debug',
    title: 'Debug It',
    sidebarTitle: 'Debug',
    description: 'Debug a run.',
  },
];
const resources = [
  resource('index', {title: 'Skill index', description: 'Find a skill.'}),
  resource('debug/SKILL.md', {category: 'Troubleshooting', prompt: 'Debug my run.'}),
  resource('debug/references/logs.md', {title: 'Logs'}),
  resource('validate/SKILL.md', {category: 'Validation', prompt: 'Validate my change.'}),
];
const routes = new Map([
  ['validate', '/how-to/validate'],
  ['debug', '/how-to/debug'],
]);

describe('skillPageEntries', () => {
  it('pairs every shipped skill with its page in page order', () => {
    const entries = skillPageEntries(resources, pages);

    assert.deepEqual(
      entries.map((entry) => [entry.skill, entry.resource.uri]),
      [
        ['validate', 'skill://shipfox/validate/SKILL.md'],
        ['debug', 'skill://shipfox/debug/SKILL.md'],
      ],
    );
  });

  it('fails when a shipped skill has no page', () => {
    assert.throws(() => skillPageEntries(resources, pages.slice(0, 1)), UNMAPPED_SKILL_PATTERN);
  });

  it('fails when a page names a skill that is not shipped', () => {
    assert.throws(() => skillPageEntries(resources.slice(0, 3), pages), MISSING_SKILL_PATTERN);
  });
});

describe('skillMarkdownToMdx', () => {
  it('drops the frontmatter and the leading title', () => {
    const mdx = skillMarkdownToMdx('---\nname: debug\n---\n\n# Debug\n\n## Steps\n', {
      skill: 'debug',
      routes,
    });

    assert.equal(mdx, '## Steps');
  });

  it('links skill and docs URIs to their pages', () => {
    const mdx = skillMarkdownToMdx(
      'Read `skill://shipfox/validate/SKILL.md`, `docs://shipfox/reference/contexts`, and `docs://shipfox/integrations/<provider>`.',
      {skill: 'debug', routes},
    );

    assert.equal(
      mdx,
      'Read [`skill://shipfox/validate/SKILL.md`](/how-to/validate), [`docs://shipfox/reference/contexts`](/reference/contexts), and `docs://shipfox/integrations/<provider>`.',
    );
  });

  it('resolves relative links against the skill directory', () => {
    const mdx = skillMarkdownToMdx(
      'See [validation](../validate/SKILL.md) and [logs](references/logs.md).',
      {skill: 'debug', routes},
    );

    assert.equal(
      mdx,
      'See [validation](/how-to/validate) and logs (`skill://shipfox/debug/references/logs.md`).',
    );
  });

  it('turns canonical docs URLs into site links', () => {
    const mdx = skillMarkdownToMdx(
      'See [routing](https://www.shipfox.io/docs/how-to/event-routing.md#fix).',
      {skill: 'debug', routes},
    );

    assert.equal(mdx, 'See [routing](/how-to/event-routing#fix).');
  });

  it('escapes MDX syntax in prose but not in code', () => {
    const mdx = skillMarkdownToMdx(
      'Use <value> and {key} with `{event}`.\n\n```yaml\nrun: echo {x} <a>\n```',
      {skill: 'debug', routes},
    );

    assert.equal(
      mdx,
      'Use \\<value> and \\{key} with `{event}`.\n\n```yaml\nrun: echo {x} <a>\n```',
    );
  });
});

describe('renderSkillPage', () => {
  it('renders the page metadata, the prompt, and the skill body', () => {
    const entries = skillPageEntries(resources, pages);
    const page = renderSkillPage(entries[1], entries);

    assert.match(page, PAGE_FRONTMATTER_PATTERN);
    assert.match(page, PAGE_PROMPT_PATTERN);
    assert.match(page, PAGE_BODY_PATTERN);
  });
});

describe('renderSkillResourceTable', () => {
  it('lists every resource and links skill files to their pages', () => {
    const table = renderSkillResourceTable(resources, skillPageEntries(resources, pages));

    assert.match(table, INDEX_ROW_PATTERN);
    assert.match(table, SKILL_ROW_PATTERN);
    assert.match(table, REFERENCE_ROW_PATTERN);
  });
});

function resource(name, {title, description, category, prompt} = {}) {
  const skill = name.split('/')[0];
  return {
    uri: `skill://shipfox/${name}`,
    name,
    title: title ?? `${skill} title`,
    description: description ?? `Use when ${skill}.`,
    catalogCategory: category,
    catalogPrompt: prompt,
    text: `---\nname: ${skill}\n---\n\n# ${skill}\n\n## ${skill} body\n`,
  };
}
