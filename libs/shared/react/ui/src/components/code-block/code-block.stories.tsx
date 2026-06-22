import {argosScreenshot} from '@argos-ci/storybook/vitest';
import type {Meta, StoryObj} from '@storybook/react';
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
  CodeTabs,
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

const exampleCode = `jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Build
        run: npm run build`;

const diffCode = `jobs:
  build:
        - runs-on: ubuntu-latest
        + runs-on: shipfox-2vcpu-ubuntu-2404`;

export const Default: Story = {
  args: {
    data: [
      {
        language: 'yaml',
        filename: '.github/workflows/<workflow-name>.yml',
        code: exampleCode,
      },
    ],
    defaultValue: 'yaml',
  },
  render: (args) => (
    <CodeBlock {...args}>
      <CodeBlockHeader>
        <CodeBlockFiles>
          {(item) => <CodeBlockFilename value={item.language}>{item.filename}</CodeBlockFilename>}
        </CodeBlockFiles>
        <CodeBlockCopyButton />
      </CodeBlockHeader>
      <CodeBlockBody>
        {(item) => (
          <CodeBlockItem value={item.language}>
            <CodeBlockContent language={item.language}>{item.code}</CodeBlockContent>
          </CodeBlockItem>
        )}
      </CodeBlockBody>
    </CodeBlock>
  ),
};

export const WithDiff: Story = {
  args: {
    data: [
      {
        language: 'yaml',
        filename: '.github/workflows/<workflow-name>.yml',
        code: diffCode,
      },
    ],
    defaultValue: 'yaml',
  },
  render: (args) => (
    <CodeBlock {...args}>
      <CodeBlockHeader>
        <CodeBlockFiles>
          {(item) => <CodeBlockFilename value={item.language}>{item.filename}</CodeBlockFilename>}
        </CodeBlockFiles>
        <CodeBlockCopyButton />
      </CodeBlockHeader>
      <CodeBlockBody>
        {(item) => (
          <CodeBlockItem value={item.language}>
            <CodeBlockContent language={item.language}>{item.code}</CodeBlockContent>
          </CodeBlockItem>
        )}
      </CodeBlockBody>
    </CodeBlock>
  ),
};

export const WithFooterRunning: Story = {
  args: {
    data: [
      {
        language: 'yaml',
        filename: '.github/workflows/<workflow-name>.yml',
        code: diffCode,
      },
    ],
    defaultValue: 'yaml',
  },
  render: (args) => (
    <CodeBlock {...args}>
      <CodeBlockHeader>
        <CodeBlockFiles>
          {(item) => <CodeBlockFilename value={item.language}>{item.filename}</CodeBlockFilename>}
        </CodeBlockFiles>
        <CodeBlockCopyButton />
      </CodeBlockHeader>
      <CodeBlockBody>
        {(item) => (
          <CodeBlockItem value={item.language}>
            <CodeBlockContent language={item.language}>{item.code}</CodeBlockContent>
          </CodeBlockItem>
        )}
      </CodeBlockBody>
      <CodeBlockFooter
        state="running"
        message="Waiting for Shipfox runner event…"
        description="This usually takes 30-60 seconds after you commit the workflow file."
      />
    </CodeBlock>
  ),
};

export const WithFooterDone: Story = {
  args: {
    data: [
      {
        language: 'yaml',
        filename: '.github/workflows/<workflow-name>.yml',
        code: diffCode,
      },
    ],
    defaultValue: 'yaml',
  },
  render: (args) => (
    <CodeBlock {...args}>
      <CodeBlockHeader>
        <CodeBlockFiles>
          {(item) => <CodeBlockFilename value={item.language}>{item.filename}</CodeBlockFilename>}
        </CodeBlockFiles>
        <CodeBlockCopyButton />
      </CodeBlockHeader>
      <CodeBlockBody>
        {(item) => (
          <CodeBlockItem value={item.language}>
            <CodeBlockContent language={item.language}>{item.code}</CodeBlockContent>
          </CodeBlockItem>
        )}
      </CodeBlockBody>
      <CodeBlockFooter state="done" message="Runner connected!" />
    </CodeBlock>
  ),
};

const multipleFilesCode = {
  'src/utils/format.ts': `export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}`,
  'src/api/client.ts': `import type {User} from './types';

export class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async getUser(id: string): Promise<User> {
    const response = await fetch(\`\${this.baseUrl}/users/\${id}\`);
    if (!response.ok) {
      throw new Error('Failed to fetch user');
    }
    return response.json();
  }
}`,
  'src/components/Button.tsx': `import type {ComponentProps} from 'react';

export function Button({
  children,
  variant = 'primary',
  ...props
}: ComponentProps<'button'> & {
  variant?: 'primary' | 'secondary';
}) {
  return (
    <button
      className={\`btn btn-\${variant}\`}
      {...props}
    >
      {children}
    </button>
  );
}`,
};

export const MultipleFiles: Story = {
  args: {
    data: [],
    defaultValue: '',
  },
  play: async (ctx) => {
    await document.fonts.ready;
    await new Promise((resolve) => setTimeout(resolve, 150));
    await argosScreenshot(ctx, 'CodeBlock MultipleFiles');
  },
  render: () => (
    <CodeTabs
      codes={multipleFilesCode}
      defaultValue="src/api/client.ts"
      syntaxHighlighting={true}
      lang="typescript"
      lineNumbers={true}
    />
  ),
};

export const WithoutLineNumbers: Story = {
  args: {
    data: [
      {
        language: 'yaml',
        filename: '.github/workflows/<workflow-name>.yml',
        code: exampleCode,
      },
    ],
    defaultValue: 'yaml',
  },
  render: (args) => (
    <CodeBlock {...args}>
      <CodeBlockHeader>
        <CodeBlockFiles>
          {(item) => <CodeBlockFilename value={item.language}>{item.filename}</CodeBlockFilename>}
        </CodeBlockFiles>
        <CodeBlockCopyButton />
      </CodeBlockHeader>
      <CodeBlockBody>
        {(item) => (
          <CodeBlockItem value={item.language} lineNumbers={false}>
            <CodeBlockContent language={item.language}>{item.code}</CodeBlockContent>
          </CodeBlockItem>
        )}
      </CodeBlockBody>
    </CodeBlock>
  ),
};

const npmCode = `npm install @shipfox/tooling`;
const yarnCode = `yarn add @shipfox/tooling`;
const pnpmCode = `pnpm add @shipfox/tooling`;

export const Snippet: Story = {
  args: {
    data: [],
    defaultValue: '',
  },
  render: () => (
    <CodeTabs
      codes={{
        npm: npmCode,
        yarn: yarnCode,
        pnpm: pnpmCode,
      }}
      defaultValue="npm"
    />
  ),
};

const syntaxHighlightingCode = {
  'index.ts': `export function hello(name: string = 'World'): void {
  // Say hello to the provided name
  console.log(\`Hello, \${name}!\`);
}

export function greetEveryone(names: string[]): void {
  for (const name of names) {
    hello(name);
  }
}

export type Greeting = {
  language: string;
  message: string;
};

export const greetings: Greeting[] = [
  { language: 'en', message: 'Hello' },
  { language: 'fr', message: 'Bonjour' },
  { language: 'es', message: 'Hola' },
  { language: 'de', message: 'Hallo' },
];

export function printGreetings(): void {
  for (const { language, message } of greetings) {
    console.log(\`\${message}, \${language}!\`);
  }
}`,
};

export const SyntaxHighlighting: StoryObj<typeof CodeTabs> = {
  args: {
    codes: syntaxHighlightingCode,
    defaultValue: 'index.ts',
    syntaxHighlighting: true,
    lang: 'typescript',
  },
  render: (args) => <CodeTabs {...args} />,
};
