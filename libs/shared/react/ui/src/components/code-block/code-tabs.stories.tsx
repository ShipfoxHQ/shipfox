import {argosScreenshot} from '@argos-ci/storybook/vitest';
import type {Meta, StoryObj} from '@storybook/react';
import {waitFor} from '@testing-library/react';
import {CodeTabs} from './index.js';

const meta = {
  title: 'Components/CodeTabs',
  component: CodeTabs,
  parameters: {
    layout: 'padded',
  },
} satisfies Meta<typeof CodeTabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  args: {
    codes: {
      npm: 'npm install @shipfox/tooling',
      yarn: 'yarn add @shipfox/tooling',
      pnpm: 'pnpm add @shipfox/tooling',
    },
    defaultValue: 'npm',
  },
};

const sourceFiles = {
  'src/utils/format.ts': `export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}`,
  'src/api/client.ts': `import type {User} from './types';

export class ApiClient {
  constructor(private baseUrl: string) {}

  async getUser(id: string): Promise<User> {
    const response = await fetch(\`\${this.baseUrl}/users/\${id}\`);
    if (!response.ok) {
      throw new Error('Failed to fetch user');
    }
    return response.json();
  }
}`,
  'src/components/Button.tsx': `import type {ComponentProps} from 'react';

export function Button({children, ...props}: ComponentProps<'button'>) {
  return <button {...props}>{children}</button>;
}`,
};

export const SourceFiles: Story = {
  args: {
    codes: sourceFiles,
    defaultValue: 'src/api/client.ts',
    lang: 'typescript',
    syntaxHighlighting: true,
    lineNumbers: true,
  },
  play: async (ctx) => {
    await waitFor(
      () => {
        if (!ctx.canvasElement.querySelector('.shiki-override')) {
          throw new Error('Shiki highlighting has not rendered yet');
        }
      },
      {timeout: 10_000},
    );
    await argosScreenshot(ctx, 'CodeTabs SourceFiles');
  },
};
