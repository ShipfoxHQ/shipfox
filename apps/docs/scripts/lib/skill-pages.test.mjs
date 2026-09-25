import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {renderSkillPage, renderSkillResourceTable, skillPageEntries} from './skill-pages.mjs';

const UNMAPPED_SKILL_PATTERN = /Skills without a docs page in SKILL_PAGES: debug/;
const MISSING_SKILL_PATTERN = /SKILL_PAGES names skills that are not shipped: validate/;
const PAGE_FRONTMATTER_PATTERN = /^---\ntitle: "Debug It"\nsidebarTitle: "Debug"\n/;
const MCP_PREREQUISITE_PATTERN =
  /- A coding agent \[connected to the Shipfox MCP\n {2}server\]\(\/how-to\/set-up-work\/connect-mcp-client\)\.\n- Have a run link\.\n/;
const PAGE_PROMPT_PATTERN =
  /in your repository and send this prompt:\n\n```text\nDebug my run\.\n```\n$/;
const INDEX_ROW_PATTERN = /^\| `skill:\/\/shipfox\/index` \| Skill index \| Find a skill\. \|$/m;
const SKILL_ROW_PATTERN = /\| \[debug title\]\(\/how-to\/debug\) \|/;
const REFERENCE_ROW_PATTERN = /\| `skill:\/\/shipfox\/debug\/references\/logs\.md` \| Logs \|/;
const pages = [page('validate'), {...page('debug'), title: 'Debug It', sidebarTitle: 'Debug'}];
const resources = [
  resource('index', {title: 'Skill index', description: 'Find a skill.'}),
  resource('debug/SKILL.md', {prompt: 'Debug my run.'}),
  resource('debug/references/logs.md', {title: 'Logs'}),
  resource('validate/SKILL.md', {prompt: 'Validate my change.'}),
];

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

describe('renderSkillPage', () => {
  it('asks for a connected coding agent and gives the prompt to send', () => {
    const page = renderSkillPage(skillPageEntries(resources, pages)[1]);

    assert.match(page, PAGE_FRONTMATTER_PATTERN);
    assert.ok(page.includes('\ndebug intro.\n'));
    assert.match(page, MCP_PREREQUISITE_PATTERN);
    assert.match(page, PAGE_PROMPT_PATTERN);
    assert.ok(!page.includes('skill'));
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

function page(skill) {
  return {
    skill,
    path: `how-to/${skill}`,
    title: `${skill} title`,
    sidebarTitle: skill,
    description: `Do ${skill}.`,
    intro: [`${skill} intro.`],
    prerequisites: ['Have a run link.'],
  };
}

function resource(name, {title, description, prompt} = {}) {
  const skill = name.split('/')[0];
  return {
    uri: `skill://shipfox/${name}`,
    name,
    title: title ?? `${skill} title`,
    description: description ?? `Use when ${skill}.`,
    catalogPrompt: prompt,
  };
}
