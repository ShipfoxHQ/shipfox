import {highlight} from 'fumadocs-core/highlight';
import {CodeBlock, Pre} from 'fumadocs-ui/components/codeblock';
import type {WorkflowSchemaExample} from '@/lib/workflow-schema/document';

export async function ExamplePane({example}: {example: WorkflowSchemaExample}) {
  const rendered = await highlight(example.code, {lang: 'yaml', components: {pre: Pre}});

  return (
    <CodeBlock
      title={example.file}
      className="my-0 xl:sticky xl:top-[calc(var(--fd-docs-row-1,0px)+var(--space-group))]"
      data-workflow-schema-example=""
    >
      {rendered}
    </CodeBlock>
  );
}
