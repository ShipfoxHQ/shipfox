import type {Meta, StoryObj} from '@storybook/react';
import {Markdown} from './markdown.js';

const sampleMarkdown = [
  '# Release note',
  '',
  'A linked [workflow run](https://example.com/runs/123) finished with annotations.',
  '',
  '## Checks',
  '',
  '- Runner claimed the job',
  '- Step logs were uploaded',
  '',
  '> This content is customer-authored Markdown rendered in a sanitized surface.',
  '',
  '| Step | Status | Duration |',
  '| --- | --- | ---: |',
  '| Build | success | 12.4s |',
  '| Test | warning | 42.1s |',
  '',
  'Inline `code` and a fenced block:',
  '',
  '```ts',
  "const status = 'success';",
  'console.log(status);',
  '```',
].join('\n');

const longTokenMarkdown = `A very long token wraps instead of overflowing: \`shipfox_${'x'.repeat(
  120,
)}\``;

const meta = {
  title: 'Components/Markdown',
  component: Markdown,
  tags: ['autodocs'],
  args: {
    children: sampleMarkdown,
  },
} satisfies Meta<typeof Markdown>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Content: Story = {
  render: () => (
    <div className="grid max-w-[720px] gap-24 bg-background-neutral-base p-24">
      <Markdown>{sampleMarkdown}</Markdown>
      <Markdown>{longTokenMarkdown}</Markdown>
      <Markdown>{'שלום [external link](https://example.com)'}</Markdown>
    </div>
  ),
};
