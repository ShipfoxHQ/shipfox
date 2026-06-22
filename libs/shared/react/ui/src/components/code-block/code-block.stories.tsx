import {argosScreenshot} from '@argos-ci/storybook/vitest';
import type {Meta, StoryObj} from '@storybook/react';
import type {ReactNode} from 'react';
import type {CodeBlockData} from './index.js';
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
  language: 'yaml',
  filename: '.github/workflows/<workflow-name>.yml',
  code: `jobs:
  build:
        - runs-on: ubuntu-latest
        + runs-on: shipfox-2vcpu-ubuntu-2404`,
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
}: {
  data: CodeBlockData[];
  lineNumbers?: boolean;
  syntaxHighlighting?: boolean;
  footer?: ReactNode;
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
            <CodeBlockContent language={item.language} syntaxHighlighting={syntaxHighlighting}>
              {item.code}
            </CodeBlockContent>
          </CodeBlockItem>
        )}
      </CodeBlockBody>
      {footer}
    </CodeBlock>
  );
}

export const Basic: Story = {
  render: () => <CodeBlockShowcase data={[workflowFile]} />,
};

export const SyntaxHighlighting: Story = {
  // Shiki loads and highlights asynchronously; wait for it so the snapshot
  // captures the highlighted output rather than the plain fallback.
  play: async (ctx) => {
    await document.fonts.ready;
    await new Promise((resolve) => setTimeout(resolve, 150));
    await argosScreenshot(ctx, 'CodeBlock SyntaxHighlighting');
  },
  render: () => <CodeBlockShowcase data={[sourceFile]} syntaxHighlighting />,
};

export const DiffHighlighting: Story = {
  render: () => <CodeBlockShowcase data={[diffFile]} />,
};

export const WithoutLineNumbers: Story = {
  render: () => <CodeBlockShowcase data={[workflowFile]} lineNumbers={false} />,
};

export const Footer: Story = {
  render: () => (
    <div className="flex flex-col gap-16">
      <CodeBlockShowcase
        data={[diffFile]}
        footer={
          <CodeBlockFooter
            state="running"
            message="Waiting for Shipfox runner event…"
            description="This usually takes 30-60 seconds after you commit the workflow file."
          />
        }
      />
      <CodeBlockShowcase
        data={[diffFile]}
        footer={<CodeBlockFooter state="done" message="Runner connected!" />}
      />
    </div>
  ),
};
