import type {Meta, StoryObj} from '@storybook/react';
import {Markdown} from '#components/markdown/index.js';
import {Message} from '#components/message/index.js';
import {Code} from '#components/typography/index.js';
import {Bubble} from './bubble.js';

const reply = `**The tests couldn't reach Postgres.** All 6 failures in \`settlement.test.ts\` are ECONNREFUSED on port 5432, so this is the setup, not your rounding change.

\`integration-tests\` has no database service. \`build\` dropped it in commit \`a91f3c2\`.`;

const codeReply = `Add the service to the job:

\`\`\`yaml
services:
  postgres:
    image: postgres:17
    ports: ["5432:5432"]
\`\`\``;

const meta = {
  title: 'Components/Bubble',
  component: Bubble,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="flex w-376 flex-col">
        <Story />
      </div>
    ),
  ],
  argTypes: {
    variant: {control: 'select', options: ['default', 'muted']},
  },
  args: {
    variant: 'default',
    children: 'Why did this fail?',
  },
} satisfies Meta<typeof Bubble>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Variants: Story = {
  render: () => (
    <div className="grid gap-16">
      <div className="grid gap-8">
        <Code variant="label" className="text-foreground-neutral-subtle">
          default
        </Code>
        <Message align="end">
          <Bubble>Why did this fail?</Bubble>
        </Message>
      </div>
      <div className="grid gap-8">
        <Code variant="label" className="text-foreground-neutral-subtle">
          muted
        </Code>
        <Message>
          <Bubble variant="muted">
            <Markdown>{reply}</Markdown>
          </Bubble>
        </Message>
      </div>
    </div>
  ),
};

export const Content: Story = {
  render: () => (
    <div className="grid gap-12">
      <Message align="end">
        <Bubble>Ok</Bubble>
      </Message>
      <Message align="end">
        <Bubble>
          {'Add a postgres service to integration-tests and open a PR.\nKeep the job name.'}
        </Bubble>
      </Message>
      <Message align="end">
        <Bubble>
          https://github.com/acme/payments-api/actions/runs/1234567890123456789/job/98765432109876543210
        </Bubble>
      </Message>
      <Message>
        <Bubble variant="muted">
          <Markdown>{codeReply}</Markdown>
        </Bubble>
      </Message>
    </div>
  ),
};
