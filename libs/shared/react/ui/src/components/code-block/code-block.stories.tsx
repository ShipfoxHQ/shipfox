import {argosScreenshot} from '@argos-ci/storybook/vitest';
import type {Meta, StoryObj} from '@storybook/react';
import {waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
import type {CodeBlockData, CodeBlockHighlightedLineRange} from './index.js';
import {
  CodeBlock,
  CodeBlockBody,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockFiles,
  CodeBlockFooter,
  CodeBlockHeader,
  CodeBlockItem,
} from './index.js';

const meta = {
  title: 'Components/CodeBlock',
  component: CodeBlock,
  parameters: {
    layout: 'padded',
  },
} satisfies Meta<typeof CodeBlock>;

export default meta;
type Story = StoryObj<typeof meta>;

const workflowFile: CodeBlockData = {
  language: 'yaml',
  filename: '.github/workflows/<workflow-name>.yml',
  code: `jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Build
        run: npm run build`,
};

const diffFile: CodeBlockData = {
  language: 'diff',
  filename: '.github/workflows/<workflow-name>.yml.diff',
  code: `diff --git a/.github/workflows/<workflow-name>.yml b/.github/workflows/<workflow-name>.yml
--- a/.github/workflows/<workflow-name>.yml
+++ b/.github/workflows/<workflow-name>.yml
@@ -1,4 +1,4 @@
 jobs:
   build:
-    runs-on: ubuntu-latest
+    runs-on: shipfox-2vcpu-ubuntu-2404`,
};

const sourceFile: CodeBlockData = {
  language: 'typescript',
  filename: 'src/runner.ts',
  code: `export async function startRunner(config: RunnerConfig): Promise<Runner> {
  const runner = await provision(config);
  await runner.waitUntilReady();
  return runner;
}`,
};

function CodeBlockShowcase({
  data,
  lineNumbers,
  syntaxHighlighting,
  footer,
  highlightedLineRange,
}: {
  data: CodeBlockData[];
  lineNumbers?: boolean;
  syntaxHighlighting?: boolean;
  footer?: ReactNode;
  highlightedLineRange?: CodeBlockHighlightedLineRange | undefined;
}) {
  return (
    <CodeBlock data={data}>
      <CodeBlockHeader>
        <CodeBlockFiles>
          {(item) => <CodeBlockFilename value={item.filename}>{item.filename}</CodeBlockFilename>}
        </CodeBlockFiles>
        <CodeBlockCopyButton />
      </CodeBlockHeader>
      <CodeBlockBody>
        {(item) => (
          <CodeBlockItem value={item.filename} lineNumbers={lineNumbers}>
            <CodeBlockContent
              language={item.language}
              syntaxHighlighting={syntaxHighlighting}
              highlightedLineRange={highlightedLineRange}
            >
              {item.code}
            </CodeBlockContent>
          </CodeBlockItem>
        )}
      </CodeBlockBody>
      {footer}
    </CodeBlock>
  );
}

export const Playground: Story = {
  render: () => <CodeBlockShowcase data={[workflowFile]} />,
};

export const SyntaxHighlighting: Story = {
  play: async (ctx) => {
    await waitFor(
      () => {
        if (!ctx.canvasElement.querySelector('.shiki-override')) {
          throw new Error('Shiki highlighting has not rendered yet');
        }
      },
      {timeout: 10_000},
    );
    await argosScreenshot(ctx, 'CodeBlock SyntaxHighlighting');
  },
  render: () => <CodeBlockShowcase data={[sourceFile]} syntaxHighlighting />,
};

export const DiffContent: Story = {
  play: async (ctx) => {
    await waitFor(
      () => {
        if (!ctx.canvasElement.querySelector('.shiki-override')) {
          throw new Error('Shiki highlighting has not rendered yet');
        }
      },
      {timeout: 10_000},
    );
    await argosScreenshot(ctx, 'CodeBlock DiffContent');
  },
  render: () => <CodeBlockShowcase data={[diffFile]} syntaxHighlighting />,
};

export const DiffLineHighlighting: Story = {
  play: async (ctx) => {
    await waitFor(
      () => {
        if (!ctx.canvasElement.querySelector('.line.diff.add.highlighted-line')) {
          throw new Error('Shiki diff line highlighting has not rendered yet');
        }
      },
      {timeout: 10_000},
    );
    await argosScreenshot(ctx, 'CodeBlock DiffLineHighlighting');
  },
  render: () => (
    <CodeBlockShowcase
      data={[diffFile]}
      syntaxHighlighting
      highlightedLineRange={{startLine: 7, endLine: 8}}
    />
  ),
};

export const LineHighlighting: Story = {
  render: () => (
    <CodeBlockShowcase data={[workflowFile]} highlightedLineRange={{startLine: 3, endLine: 5}} />
  ),
};

export const WithoutLineNumbers: Story = {
  render: () => <CodeBlockShowcase data={[workflowFile]} lineNumbers={false} />,
};

export const Footer: Story = {
  render: () => (
    <div className="flex flex-col gap-16">
      <CodeBlockShowcase
        data={[workflowFile]}
        footer={
          <CodeBlockFooter
            state="running"
            message="Waiting for Shipfox runner event…"
            description="This usually takes 30-60 seconds after you commit the workflow file."
          />
        }
      />
      <CodeBlockShowcase
        data={[workflowFile]}
        footer={<CodeBlockFooter state="done" message="Runner connected!" />}
      />
    </div>
  ),
};
