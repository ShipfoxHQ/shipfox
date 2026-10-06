import assert from 'node:assert/strict';
import test from 'node:test';
import type {CatalogProvider} from './integration-catalog';
import {
  assertMachineReadableMarkdown,
  canonicalDocsUrl,
  canonicalizeDocumentationUrl,
  renderAgentHandoff,
  rewriteMachineReadableLinks,
  serializeMachineReadableMarkdown,
  stringifyMachineReadableComponent,
} from './machine-readable';
import {inlineCode} from './markdown';

const github: CatalogProvider = {
  slug: 'github',
  name: 'GitHub',
  summary: 'Connect repositories, receive events, and give agents scoped GitHub tools.',
  capabilities: ['source_control', 'events', 'agent_tools'],
  categories: ['source-control'],
  aliases: ['git', 'vcs'],
  icon: 'github',
  overviewHref: '/integrations/github',
  setupHref: '/integrations/github/setup',
  eventCount: 18,
  toolCount: 21,
};

test('builds canonical documentation URLs independently of the deployment host', () => {
  assert.equal(
    canonicalDocsUrl('/reference/workflow-schema'),
    'https://www.shipfox.io/docs/reference/workflow-schema',
  );
  assert.equal(
    canonicalizeDocumentationUrl('https://shipfox-docs.vercel.app/docs/reference/contexts'),
    'https://www.shipfox.io/docs/reference/contexts',
  );
  assert.equal(
    canonicalizeDocumentationUrl('https://docs.github.com/en/webhooks'),
    'https://docs.github.com/en/webhooks',
  );
  assert.equal(
    canonicalizeDocumentationUrl('../contexts', '/reference/workflow-schema'),
    'https://www.shipfox.io/docs/contexts',
  );
  assert.equal(
    canonicalizeDocumentationUrl('https://www.shipfox.io/changelog'),
    'https://www.shipfox.io/changelog',
  );
  assert.equal(
    canonicalizeDocumentationUrl('https://other-app.vercel.app/reference/contexts'),
    'https://other-app.vercel.app/reference/contexts',
  );
});

test('rewrites documentation links and media while preserving code fences', () => {
  const markdown = [
    '[Workflow schema](/reference/workflow-schema#top-level-fields)',
    '![Deployment topology](/img/diagrams/deployment-topology.png)',
    '[GitHub](https://github.com/ShipfoxHQ/shipfox)',
    '```yaml',
    'url: /reference/workflow-schema',
    '```',
  ].join('\n');

  const rewritten = rewriteMachineReadableLinks(markdown);

  assert.ok(
    rewritten.includes('https://www.shipfox.io/docs/reference/workflow-schema#top-level-fields'),
  );
  assert.ok(rewritten.includes('https://www.shipfox.io/docs/img/diagrams/deployment-topology.png'));
  assert.ok(rewritten.includes('url: /reference/workflow-schema'));
  assert.ok(rewritten.includes('https://github.com/ShipfoxHQ/shipfox'));
  assert.equal(
    rewriteMachineReadableLinks('[Fields](#top-level-fields)', '/reference/workflow-schema'),
    '[Fields](https://www.shipfox.io/docs/reference/workflow-schema#top-level-fields)',
  );

  const fencedMarkers = [
    '~~~yaml',
    '[Inside](/reference/contexts)',
    '```',
    '[Still inside](/reference/workflow-schema)',
    '~~~',
    '[Outside](/reference/contexts)',
  ].join('\n');
  const rewrittenFencedMarkers = rewriteMachineReadableLinks(fencedMarkers);
  assert.ok(rewrittenFencedMarkers.includes('[Still inside](/reference/workflow-schema)'));
  assert.ok(
    rewrittenFencedMarkers.includes('[Outside](https://www.shipfox.io/docs/reference/contexts)'),
  );

  const html = rewriteMachineReadableLinks(
    [
      '<a href="/reference/contexts">Contexts</a>',
      '<img src="/img/diagrams/deployment-topology.png" alt="Topology">',
      '<a href="https://shipfox-docs.vercel.app/docs/reference/contexts">Preview</a>',
    ].join('\n'),
  );
  assert.ok(html.includes('href="https://www.shipfox.io/docs/reference/contexts"'));
  assert.ok(
    html.includes('src="https://www.shipfox.io/docs/img/diagrams/deployment-topology.png"'),
  );
  assert.ok(html.includes('alt="Topology"'));
});

test('serializes integration catalog placeholders as complete Markdown facts', () => {
  const markdown = serializeMachineReadableMarkdown(
    '\0{"name":"IntegrationCatalog","children":"","attributes":{}}\0',
    {
      audience: 'human',
      integrationCatalog: [github],
      requiredFacts: ['## Integration catalog', '### GitHub'],
    },
  );

  assert.ok(markdown.includes('| Slug | `github` |'));
  assert.ok(
    markdown.includes(
      '| Events | 18 ([event catalog](https://www.shipfox.io/docs/integrations/github/events)) |',
    ),
  );
  assert.ok(markdown.includes('| Tools | 21'));
  assert.equal(markdown.includes('](/'), false);
});

test('lists on-request integrations as unavailable to workflows', () => {
  const markdown = serializeMachineReadableMarkdown(
    '\0{"name":"IntegrationCatalog","children":"","attributes":{}}\0',
    {
      audience: 'human',
      integrationCatalog: [github],
      requestableIntegrations: [
        {
          slug: 'gitlab',
          name: 'GitLab',
          summary: 'Trigger workflows from merge requests.',
          categories: ['source-control'],
          aliases: ['git'],
          iconPath: 'M0 0h24v24H0z',
        },
      ],
      requiredFacts: ['## Integration catalog', '## Available on request'],
    },
  );

  assert.ok(markdown.includes('a workflow cannot reference it'));
  assert.ok(
    markdown.includes('| GitLab | Source control | Trigger workflows from merge requests. |'),
  );
});

test('replaces unusable imported image sources with descriptive text', () => {
  const markdown = serializeMachineReadableMarkdown('<img alt="Run detail" src="__img0" />', {
    audience: 'human',
  });

  assert.equal(markdown, '[Image: Run detail]');
});

test('fails deterministic checks for unresolved components and links', () => {
  assert.doesNotThrow(() => assertMachineReadableMarkdown('# Test (https://www.shipfox.io/docs)'));
  assert.throws(() => assertMachineReadableMarkdown('https://www.shipfox.io/docs.foo'), {
    message: 'Machine-readable Markdown contains a non-canonical Shipfox URL.',
  });
  assert.throws(
    () =>
      serializeMachineReadableMarkdown(
        '\0{"name":"UnknownComponent","children":"","attributes":{}}\0',
        {audience: 'human'},
      ),
    {
      message:
        'Machine-readable Markdown contains an unresolved component placeholder: UnknownComponent',
    },
  );
  assert.throws(() => assertMachineReadableMarkdown('<TopLevelFields />'), {
    message: 'Machine-readable Markdown contains an unresolved MDX component: <TopLevelFields />',
  });
  assert.throws(() => assertMachineReadableMarkdown('[Contexts](/reference/contexts)'), {
    message: 'Machine-readable Markdown contains a root-relative link or media URL.',
  });
  assert.throws(
    () =>
      assertMachineReadableMarkdown('## Workflow schema', {
        pageUrl: '/reference/workflow-schema',
        requiredFacts: ['| `name` |'],
      }),
    {
      message:
        'Machine-readable Markdown for /reference/workflow-schema is missing generated fact: | `name` |',
    },
  );
  assert.throws(
    () =>
      assertMachineReadableMarkdown('## Contexts', {
        pageUrl: 'https://shipfox-docs.vercel.app/reference/contexts',
      }),
    {
      message:
        'Machine-readable Markdown for https://shipfox-docs.vercel.app/reference/contexts contains a preview or local docs URL.',
    },
  );
  assert.throws(
    () =>
      assertMachineReadableMarkdown('## Changelog', {
        pageUrl: 'https://www.shipfox.io/changelog',
      }),
    {
      message:
        'Machine-readable Markdown for https://www.shipfox.io/changelog contains a non-canonical Shipfox URL.',
    },
  );
});

test('uses safe Markdown code spans for values containing backticks', () => {
  assert.equal(inlineCode('value`with`backticks'), '``value`with`backticks``');
  assert.equal(inlineCode('`'), '`` ` ``');
  assert.equal(inlineCode(' \t '), '`  \t  `');
});

const handoff = {
  skill: 'create-workflow-from-template',
  prompt: 'Use Shipfox to create a workflow from a template.',
} as const;

function handoffElement(type: 'mdxJsxFlowElement' | 'mdxJsxTextElement', skill: string) {
  return {
    type,
    name: 'AgentHandoff',
    children: [],
    attributes: [
      {type: 'mdxJsxAttribute', name: 'skill', value: skill},
      {type: 'mdxJsxAttribute', name: 'prompt', value: handoff.prompt},
    ],
  };
}

function stringifyHandoff(type: 'mdxJsxFlowElement' | 'mdxJsxTextElement', skill: string) {
  const stringify = stringifyMachineReadableComponent as unknown as (node: unknown) => unknown;
  return stringify(handoffElement(type, skill));
}

test('drops the decorative Shippy illustrations', () => {
  const stringify = stringifyMachineReadableComponent as unknown as (node: unknown) => unknown;

  for (const name of ['Shippy', 'QuickStartComic']) {
    const placeholder = stringify({type: 'mdxJsxFlowElement', name, children: [], attributes: []});

    assert.equal(typeof placeholder, 'string');
    assert.equal(
      serializeMachineReadableMarkdown(`Before.\n\n${placeholder}\n\nAfter.`, {audience: 'human'}),
      serializeMachineReadableMarkdown('Before.\n\nAfter.', {audience: 'human'}),
    );
  }
});

test('renders an agent handoff as the prompt to send for a human reader', () => {
  assert.equal(
    renderAgentHandoff({...handoff, audience: 'human'}),
    [
      'Open your coding agent in your repository and send this prompt:',
      '',
      '```text',
      'Use Shipfox to create a workflow from a template.',
      '```',
    ].join('\n'),
  );
});

test('fences an agent handoff prompt that contains a code fence', () => {
  const rendered = renderAgentHandoff({
    ...handoff,
    prompt: 'Run:\n```sh\nshipfox validate\n```',
    audience: 'human',
  });

  assert.ok(rendered.includes('````text\nRun:\n```sh\nshipfox validate\n```\n````'));
});

test('renders an agent handoff as facts about the skill for an MCP reader', () => {
  assert.equal(
    renderAgentHandoff({...handoff, audience: 'mcp'}),
    [
      '> **For coding agents:** The procedure for this task is the',
      '> `create-workflow-from-template` skill,',
      '> `skill://shipfox/create-workflow-from-template/SKILL.md`.',
      '> Example request: "Use Shipfox to create a workflow from a template."',
    ].join('\n'),
  );
});

test('fails an agent handoff that names a skill that is not shipped', () => {
  assert.throws(() => renderAgentHandoff({skill: 'no-such-skill', prompt: 'x', audience: 'mcp'}), {
    message: 'AgentHandoff names a skill that is not shipped: no-such-skill',
  });
  const placeholder = stringifyHandoff('mdxJsxFlowElement', 'no-such-skill') as string;
  for (const audience of ['human', 'mcp'] as const) {
    assert.throws(() => serializeMachineReadableMarkdown(placeholder, {audience}), {
      message: 'AgentHandoff names a skill that is not shipped: no-such-skill',
    });
  }
});

test('fails an agent handoff used inside a paragraph', () => {
  assert.throws(() => stringifyHandoff('mdxJsxTextElement', handoff.skill), {
    message: 'AgentHandoff must be a block on its own line, not part of a paragraph.',
  });
});

test('resolves an agent handoff placeholder for each audience', () => {
  const placeholder = stringifyHandoff('mdxJsxFlowElement', handoff.skill);
  assert.equal(typeof placeholder, 'string');
  const markdown = `Intro.\n\n${placeholder}\n\nOutro.`;

  assert.equal(
    serializeMachineReadableMarkdown(markdown, {audience: 'human'}),
    `Intro.\n\n${renderAgentHandoff({...handoff, audience: 'human'})}\n\nOutro.`,
  );
  assert.equal(
    serializeMachineReadableMarkdown(markdown, {audience: 'mcp'}),
    `Intro.\n\n${renderAgentHandoff({...handoff, audience: 'mcp'})}\n\nOutro.`,
  );
});

test('keeps an agent handoff inside the blockquote that holds its placeholder', () => {
  const placeholder = stringifyHandoff('mdxJsxFlowElement', handoff.skill);
  const markdown = `> **Note**\n>\n> ${placeholder}`;

  assert.equal(
    serializeMachineReadableMarkdown(markdown, {audience: 'mcp'}),
    [
      '> **Note**',
      '>',
      '> > **For coding agents:** The procedure for this task is the',
      '> > `create-workflow-from-template` skill,',
      '> > `skill://shipfox/create-workflow-from-template/SKILL.md`.',
      '> > Example request: "Use Shipfox to create a workflow from a template."',
    ].join('\n'),
  );
});

test('keeps the trailing spaces of a prompt line inside a quoted agent handoff', () => {
  const placeholder = `\0${JSON.stringify({
    name: 'AgentHandoff',
    children: '',
    attributes: {...handoff, prompt: 'First line  \n\nLast line'},
  })}\0`;

  const lines = serializeMachineReadableMarkdown(`> ${placeholder}`, {audience: 'human'}).split(
    '\n',
  );

  assert.ok(lines.includes('> First line  '));
  assert.ok(lines.includes('>'));
});

function stringifyForHumans(
  type: 'mdxJsxFlowElement' | 'mdxJsxTextElement',
  children: string[],
): unknown {
  const stringify = stringifyMachineReadableComponent as unknown as (
    node: unknown,
    parent: unknown,
    state: unknown,
  ) => unknown;
  const state = {
    containerFlow: (parent: {children: {value: string}[]}) =>
      parent.children.map((child) => child.value).join('\n\n'),
  };

  return stringify(
    {
      type,
      name: 'ForHumans',
      attributes: [],
      children: children.map((value) => ({type: 'html', value})),
    },
    undefined,
    state,
  );
}

function forHumansPage(): string {
  const placeholder = stringifyForHumans('mdxJsxFlowElement', [
    'Paste this prompt.',
    'Then review the result.',
  ]);
  assert.equal(typeof placeholder, 'string');
  return `Intro.\n\n${placeholder}\n\nOutro.`;
}

test('keeps ForHumans children in the human rendering', () => {
  assert.equal(
    serializeMachineReadableMarkdown(forHumansPage(), {audience: 'human'}),
    'Intro.\n\nPaste this prompt.\n\nThen review the result.\n\nOutro.',
  );
});

test('drops the ForHumans block from the mcp rendering', () => {
  assert.equal(
    serializeMachineReadableMarkdown(forHumansPage(), {audience: 'mcp'}),
    'Intro.\n\nOutro.',
  );
});

test('fails a ForHumans used inside a paragraph', () => {
  assert.throws(() => stringifyForHumans('mdxJsxTextElement', ['inline']), {
    message: 'ForHumans must be a block on its own line, not part of a paragraph.',
  });
});

test('fails a generated component inside ForHumans', () => {
  const nested = '\0{"name":"TemplateDetail","children":"","attributes":{"id":"ticket-to-pr"}}\0';

  assert.throws(() => stringifyForHumans('mdxJsxFlowElement', [nested]), {
    message: 'ForHumans cannot contain a generated component.',
  });
});

test('fails a ForHumans nested inside a Callout', () => {
  const placeholder = stringifyForHumans('mdxJsxFlowElement', ['Paste this prompt.']);

  for (const audience of ['human', 'mcp'] as const) {
    assert.throws(
      () => serializeMachineReadableMarkdown(`> **Note**\n> ${placeholder}\n> After`, {audience}),
      {message: 'ForHumans cannot be nested inside a Callout, quote, or list.'},
    );
  }
});
