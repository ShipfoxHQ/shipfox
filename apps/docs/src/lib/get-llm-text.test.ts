import assert from 'node:assert/strict';
import test from 'node:test';
import {getShippedSkillResource} from '@shipfox/workflow-templates';
import {getLLMText} from './get-llm-text';
import {canonicalDocsUrl} from './machine-readable';

type TestPage = Parameters<typeof getLLMText>[0];
const DESCRIPTION_PATTERN = /\n\nDescription: Test page description\n\n/;

const pages = [
  {
    url: '/reference/workflow-schema',
    body: [
      '## Workflow',
      '| `name` |',
      '## `concurrency`',
      '| `group` |',
      '### `steps[*]` agent step',
      '| `prompt` |',
    ].join('\n'),
  },
  {
    url: '/reference/contexts',
    body: [
      '## Available contexts',
      '| Context | Holds |',
      '## Context properties',
      '| Property | Type | Description |',
    ].join('\n'),
  },
  {
    url: '/reference/model-providers',
    body: ['## Supported providers', '| Provider | `provider` ID |'].join('\n'),
  },
  {
    url: '/integrations/github/events',
    body: ['## Event catalog', '#### `push`'].join('\n'),
  },
  {
    url: '/integrations/github/tools',
    body: ['## Tool catalog', '##### Input'].join('\n'),
  },
] as const;

function testPage(url: string, body: string, description = 'Test page description'): TestPage {
  return {
    url,
    data: {
      title: 'Test page',
      description,
      getText: async () => body,
    },
  } as unknown as TestPage;
}

test('applies required generated facts to every reference page family', async () => {
  for (const page of pages) {
    const markdown = await getLLMText(testPage(page.url, page.body), {audience: 'human'});
    assert.equal(markdown.split('\n', 1)[0], `# Test page (${canonicalDocsUrl(page.url)})`);
    assert.match(markdown, DESCRIPTION_PATTERN);
    assert.ok(markdown.includes(page.body));
  }
});

test('reports the source page when description or generated facts are missing', async () => {
  await assert.rejects(
    getLLMText(testPage('/reference/contexts', '## Available contexts', ''), {audience: 'human'}),
    {
      message: 'Documentation page "/reference/contexts" is missing a description.',
    },
  );
  await assert.rejects(
    getLLMText(testPage('/reference/workflow-schema', '## Workflow'), {audience: 'human'}),
    {
      message:
        'Machine-readable Markdown for /reference/workflow-schema is missing generated fact: | `name` |',
    },
  );
});

test('renders the same Markdown for both audiences until a page distinguishes them', async () => {
  const page = testPage('/reference/model-providers', pages[2].body);

  assert.equal(
    await getLLMText(page, {audience: 'mcp'}),
    await getLLMText(page, {audience: 'human'}),
  );
});

test('names the skill on a skill page in the mcp rendering and keeps the human rendering', async () => {
  const skill = 'create-workflow-from-template';
  const prompt = 'Use Shipfox to create a workflow from a template.';
  const resource = getShippedSkillResource(`skill://shipfox/${skill}/SKILL.md`);
  assert.ok(resource);
  assert.equal(resource.catalogPrompt, prompt);
  const guide = [
    'This guide is meant to be carried out by your coding agent.',
    "You start it with one prompt, answer the agent's questions, and review what it reports.",
  ].join('\n');
  const body = [
    'Start from a template.',
    placeholder({name: 'ForHumans', children: guide, attributes: {}}),
    '## Start the agent',
    placeholder({name: 'AgentHandoff', children: '', attributes: {skill, prompt}}),
  ].join('\n\n');
  const page = testPage('/how-to/author-workflows/create-workflow-from-template', body);

  const human = await getLLMText(page, {audience: 'human'});
  const mcp = await getLLMText(page, {audience: 'mcp'});

  assert.ok(
    human.endsWith(
      [
        'Start from a template.',
        guide,
        '## Start the agent',
        'Open your coding agent in your repository and send this prompt:',
        `\`\`\`text\n${prompt}\n\`\`\``,
      ].join('\n\n'),
    ),
  );
  assert.ok(mcp.includes(resource.uri));
  assert.ok(!mcp.includes('```'));
  assert.ok(!mcp.includes('meant to be carried out by your coding agent'));
});

function placeholder(component: {name: string; children: string; attributes: object}): string {
  return `\0${JSON.stringify(component)}\0`;
}
