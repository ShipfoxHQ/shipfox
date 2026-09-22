import {highlight} from 'fumadocs-core/highlight';
import {
  CodeBlock,
  CodeBlockTab,
  CodeBlockTabs,
  CodeBlockTabsList,
  CodeBlockTabsTrigger,
  Pre,
} from 'fumadocs-ui/components/codeblock';
import type {ToolReferenceExample} from '@/lib/tool-reference/document';

export async function CodePanel({examples}: {examples: ToolReferenceExample[]}) {
  const rendered = await Promise.all(
    examples.map(async (example) => ({
      ...example,
      node: await highlight(example.code, {lang: example.language, components: {pre: Pre}}),
    })),
  );
  const first = rendered[0];
  if (!first) return null;

  return (
    <CodeBlockTabs className="my-0" defaultValue={first.title}>
      <CodeBlockTabsList>
        {rendered.map((example) => (
          <CodeBlockTabsTrigger key={example.title} value={example.title}>
            {example.title}
          </CodeBlockTabsTrigger>
        ))}
      </CodeBlockTabsList>
      {rendered.map((example) => (
        <CodeBlockTab key={example.title} value={example.title}>
          <CodeBlock className="my-0 max-h-[32rem] overflow-auto rounded-t-none border-0">
            {example.node}
          </CodeBlock>
        </CodeBlockTab>
      ))}
    </CodeBlockTabs>
  );
}
