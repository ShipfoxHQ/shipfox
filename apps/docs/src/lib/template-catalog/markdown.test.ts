import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {serializeTemplateCatalog, serializeTemplateDetail} from './markdown';
import type {TemplateCatalogEntry, TemplateDetail} from './types';

const WRITES_PATTERN =
  /## What it writes\n\n- GitHub: Pushes a branch\.\n- With a tracker, comments on the ticket\.\n\n/;
const PREREQUISITES_HEADING_PATTERN = /## Before you start/;
const PREREQUISITES_PATTERN =
  /## Before you start\n\n- Invite the Shipfox app to the channel\.\n\n/;

const HUMAN_SETUP_PATTERN =
  /## Set up this workflow\n\nOpen your coding agent in your repository and paste this prompt\. The agent needs the \[Shipfox MCP server\]\(\/how-to\/set-up-work\/connect-mcp-client\)\.\n\n```text\n[\s\S]+?\n```\n\nThe workflow file, `\.shipfox\/workflows\/ask-codebase\.yml`, with every default:\n\n```yaml\nname: ask\n```/;
const SKILL_URI_PATTERN = /skill:\/\//;
const MCP_SETUP_PATTERN =
  /## Set up this workflow\n\n> \*\*For coding agents:\*\* The procedure for this task is the\n> `create-workflow-from-template` skill,\n> `skill:\/\/shipfox\/create-workflow-from-template\/SKILL\.md`\.\n> Example request: "[^\n]+"\n\nThe workflow file, `\.shipfox\/workflows\/ask-codebase\.yml`, with every default:\n\n```yaml\nname: ask\n```/;
const FENCED_PROMPT_PATTERN = /```text/;
const SETUP_SECTION_PATTERN = /## Set up this workflow\n\n[\s\S]+?(?=\nThe workflow file)/;

const entry: TemplateCatalogEntry = {
  id: 'ask-codebase',
  title: 'Ask the codebase in Slack',
  summary: 'Answer questions about your code in Slack.',
  revision: 1,
  addedAt: '2026-09-26',
  keywords: ['questions'],
  starts: 'Someone mentions the Shipfox app in Slack',
  flow: [{kind: 'trigger', provider: 'slack', title: 'Someone asks', detail: 'They mention it.'}],
  writes: [{provider: 'slack', action: 'Replies once in the thread.'}],
  roles: [
    {role: 'chat', providers: ['slack'], optional: false, fromProject: false},
    {role: 'source', providers: ['github'], optional: false, fromProject: true},
  ],
  href: '/examples/ask-codebase',
};

function detail(overrides: Partial<TemplateDetail>): TemplateDetail {
  return {
    ...entry,
    prerequisites: [],
    options: [],
    models: [],
    variants: [{bindings: {chat: 'slack', source: 'github'}, yaml: 'name: ask\n'}],
    related: [],
    ...overrides,
  };
}

describe('serializeTemplateCatalog', () => {
  it('lists each example with its start and integrations', () => {
    assert.equal(
      serializeTemplateCatalog([entry]),
      '- [Ask the codebase in Slack](/examples/ask-codebase): Answer questions about your code in Slack. Starts when: Someone mentions the Shipfox app in Slack. Integrations: Slack, GitHub.',
    );
  });
});

describe('serializeTemplateDetail', () => {
  it('names the provider of a write and leaves out one that depends on the reader', () => {
    const markdown = serializeTemplateDetail({
      template: detail({
        writes: [
          {provider: 'github', action: 'Pushes a branch.'},
          {action: 'With a tracker, comments on the ticket.'},
        ],
      }),
      audience: 'human',
    });

    assert.match(markdown, WRITES_PATTERN);
  });

  it('lists the prerequisites only when the template has some', () => {
    assert.doesNotMatch(
      serializeTemplateDetail({template: detail({}), audience: 'human'}),
      PREREQUISITES_HEADING_PATTERN,
    );
    assert.match(
      serializeTemplateDetail({
        template: detail({prerequisites: ['Invite the Shipfox app to the channel.']}),
        audience: 'human',
      }),
      PREREQUISITES_PATTERN,
    );
  });

  it('tells a person to paste the prompt, then shows the workflow file', () => {
    const markdown = serializeTemplateDetail({template: detail({}), audience: 'human'});

    assert.match(markdown, HUMAN_SETUP_PATTERN);
    assert.doesNotMatch(markdown, SKILL_URI_PATTERN);
  });

  it('names the skill to an MCP agent, then shows the workflow file', () => {
    const markdown = serializeTemplateDetail({template: detail({}), audience: 'mcp'});

    assert.match(markdown, MCP_SETUP_PATTERN);
    assert.doesNotMatch(markdown, FENCED_PROMPT_PATTERN);
  });

  it('renders the same page for both audiences outside the setup section', () => {
    const human = serializeTemplateDetail({template: detail({}), audience: 'human'});
    const mcp = serializeTemplateDetail({template: detail({}), audience: 'mcp'});

    assert.equal(stripSetup(mcp), stripSetup(human));
  });
});

function stripSetup(markdown: string): string {
  return markdown.replace(SETUP_SECTION_PATTERN, '');
}
