import assert from 'node:assert/strict';
import test from 'node:test';
import {remarkStructure} from 'fumadocs-core/mdx-plugins';

const SHARED_TEXT = 'Connect your coding agent before you start.';

function text(value: string) {
  return {type: 'text', value};
}

function paragraph(value: string) {
  return {type: 'paragraph', children: [text(value)]};
}

function agentHandoff() {
  return {
    type: 'mdxJsxFlowElement',
    name: 'AgentHandoff',
    children: [],
    attributes: [
      {type: 'mdxJsxAttribute', name: 'skill', value: 'create-workflow-from-template'},
      {
        type: 'mdxJsxAttribute',
        name: 'prompt',
        value: 'Use Shipfox to create a workflow from a template.',
      },
    ],
  };
}

function structuredData(children: unknown[]) {
  const file: {data: {structuredData?: {contents: {content: string}[]}}} = {data: {}};
  const tree = {type: 'root', children};
  // The plugin reads the processor's settings through `this.data()`.
  const processor = {data: () => undefined};
  const transform = Reflect.apply(remarkStructure, processor, []) as (
    tree: unknown,
    file: unknown,
  ) => void;
  transform(tree, file);
  return file.data.structuredData?.contents.map((item) => item.content) ?? [];
}

// Neither the MCP text nor the attributes reach the index, and the text around the handoff stays.
function assertSharedTextOnly(contents: string[]) {
  assert.equal(contents.length, 1);
  assert.ok(contents[0]?.includes(SHARED_TEXT));
  for (const leaked of ['For coding agents', 'skill', 'Example request', 'Use Shipfox']) {
    assert.ok(!contents[0]?.includes(leaked), `indexed text contains "${leaked}"`);
  }
}

test('indexes an agent handoff in a blockquote without any MCP text', () => {
  const contents = structuredData([
    {type: 'blockquote', children: [paragraph(SHARED_TEXT), agentHandoff()]},
  ]);

  assertSharedTextOnly(contents);
});

test('indexes an agent handoff in a Callout without any MCP text', () => {
  const contents = structuredData([
    {
      type: 'mdxJsxFlowElement',
      name: 'Callout',
      attributes: [],
      children: [paragraph(SHARED_TEXT), agentHandoff()],
    },
  ]);

  assertSharedTextOnly(contents);
});

test('indexes nothing for a bare agent handoff', () => {
  assert.deepEqual(structuredData([paragraph(SHARED_TEXT), agentHandoff()]), [SHARED_TEXT]);
});
