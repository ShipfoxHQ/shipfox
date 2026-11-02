import type {Meta, StoryObj} from '@storybook/react';
import {Badge} from '#components/badge/index.js';
import {Bubble} from '#components/bubble/index.js';
import {Markdown} from '#components/markdown/index.js';
import {Trace, TraceDescription, TraceLine, TraceTitle} from '#components/trace/index.js';
import {Message, MessageFooter} from './message.js';

const meta = {
  title: 'Components/Message',
  component: Message,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-376">
        <Story />
      </div>
    ),
  ],
  argTypes: {
    align: {control: 'select', options: ['start', 'end']},
  },
  args: {
    align: 'end',
  },
} satisfies Meta<typeof Message>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <Message {...args}>
      <Bubble variant={args.align === 'end' ? 'default' : 'muted'}>Why did this fail?</Bubble>
    </Message>
  ),
};

export const Footers: Story = {
  render: () => (
    <div className="grid gap-12">
      <Message align="end">
        <Bubble>Also check the lint job.</Bubble>
        <MessageFooter>
          <Badge variant="neutral" size="2xs">
            Queued
          </Badge>
        </MessageFooter>
      </Message>
      <Message>
        <Bubble variant="muted">
          <Markdown>The tests couldn't reach Postgres. All 6 failures in</Markdown>
        </Bubble>
        <MessageFooter>Stopped</MessageFooter>
      </Message>
    </div>
  ),
};

export const Compositions: Story = {
  render: () => (
    <div className="grid gap-12">
      <Message align="end">
        <Bubble>Why did this fail?</Bubble>
      </Message>
      <Trace>
        <TraceLine status="succeeded">
          <TraceTitle>Read run</TraceTitle>
          <TraceDescription>deploy-preview #214</TraceDescription>
        </TraceLine>
      </Trace>
      <Message>
        <Bubble variant="muted">
          <Markdown>
            {"**The tests couldn't reach Postgres.** `integration-tests` has no database service."}
          </Markdown>
        </Bubble>
      </Message>
    </div>
  ),
};
