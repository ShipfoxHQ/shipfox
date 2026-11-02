import type {Meta, StoryObj} from '@storybook/react';
import {Code} from '#components/typography/index.js';
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceDetail,
  TraceLine,
  TraceTitle,
} from './trace.js';

const logExcerpt = `416 > ledger/settlement.test.ts (6 failed)
418   Error: connect ECONNREFUSED 127.0.0.1:5432`;

const longLog = Array.from(
  {length: 40},
  (_, index) =>
    `${String(index + 400).padStart(3, '0')}   ledger/settlement.test.ts > rounds half-even at scale ${index} with a long failure message`,
).join('\n');

const meta = {
  title: 'Components/Trace',
  component: TraceLine,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-368">
        <Story />
      </div>
    ),
  ],
  argTypes: {
    status: {control: 'select', options: ['running', 'succeeded', 'failed', 'unknown']},
  },
  args: {
    status: 'succeeded',
  },
} satisfies Meta<typeof TraceLine>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <Trace>
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine {...args}>
            <TraceTitle>Read logs of</TraceTitle>
            <TraceDescription>Run tests</TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <TraceDetail>{logExcerpt}</TraceDetail>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  ),
};

export const States: Story = {
  render: () => (
    <div className="grid gap-16">
      {(['running', 'succeeded', 'failed', 'unknown'] as const).map((status) => (
        <div key={status} className="grid gap-8">
          <Code variant="label" className="text-foreground-neutral-subtle">
            {status}
          </Code>
          <Trace>
            <TraceCollapsible>
              <TraceCollapsibleTrigger>
                <TraceLine status={status}>
                  <TraceTitle>Read run</TraceTitle>
                  <TraceDescription>deploy-preview #214</TraceDescription>
                </TraceLine>
              </TraceCollapsibleTrigger>
              <TraceCollapsibleContent>
                <TraceDetail>{logExcerpt}</TraceDetail>
              </TraceCollapsibleContent>
            </TraceCollapsible>
            <TraceCollapsible defaultOpen>
              <TraceCollapsibleTrigger>
                <TraceLine status={status}>
                  <TraceTitle>Read logs of</TraceTitle>
                  <TraceDescription>Run tests</TraceDescription>
                </TraceLine>
              </TraceCollapsibleTrigger>
              <TraceCollapsibleContent>
                <TraceDetail>{logExcerpt}</TraceDetail>
              </TraceCollapsibleContent>
            </TraceCollapsible>
          </Trace>
        </div>
      ))}
    </div>
  ),
};

export const Interactions: Story = {
  render: () => (
    <div className="grid gap-16">
      {[
        {label: 'hover', className: 'hover'},
        {label: 'focus', className: 'focus'},
      ].map(({label, className}) => (
        <div key={label} className="grid gap-8">
          <Code variant="label" className="text-foreground-neutral-subtle">
            {label}
          </Code>
          <Trace>
            <TraceCollapsible>
              <TraceCollapsibleTrigger className={className}>
                <TraceLine status="succeeded">
                  <TraceTitle>Read workflow</TraceTitle>
                  <TraceDescription>deploy-preview.yml</TraceDescription>
                </TraceLine>
              </TraceCollapsibleTrigger>
            </TraceCollapsible>
          </Trace>
        </div>
      ))}
    </div>
  ),
  parameters: {
    pseudo: {
      hover: '.hover',
      focusVisible: '.focus',
    },
  },
};

export const Content: Story = {
  render: () => (
    <Trace>
      <TraceLine status="running">
        <TraceTitle>Reading run</TraceTitle>
        <TraceDescription>deploy-preview #214</TraceDescription>
      </TraceLine>
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine status="succeeded">
            <TraceTitle>Read file</TraceTitle>
            <TraceDescription>
              libs/api/ledger/src/core/settlement/rounding/half-even.test.ts
            </TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
      </TraceCollapsible>
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine status="succeeded">
            <TraceTitle>
              Read a tool result whose title is long enough to fill the row and truncate
            </TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
      </TraceCollapsible>
      <TraceCollapsible defaultOpen>
        <TraceCollapsibleTrigger>
          <TraceLine status="failed">
            <TraceTitle>Failed to read logs of</TraceTitle>
            <TraceDescription>Run tests</TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <TraceDetail>{longLog}</TraceDetail>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  ),
};

export const Compositions: Story = {
  render: () => (
    <Trace>
      <TraceCollapsible defaultOpen>
        <TraceCollapsibleTrigger>
          <TraceLine status="succeeded">
            <TraceTitle>Read 3 sources</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="pl-16">
          <Trace>
            <TraceCollapsible>
              <TraceCollapsibleTrigger>
                <TraceLine status="succeeded">
                  <TraceTitle>Read run</TraceTitle>
                  <TraceDescription>deploy-preview #214</TraceDescription>
                </TraceLine>
              </TraceCollapsibleTrigger>
            </TraceCollapsible>
            <TraceCollapsible>
              <TraceCollapsibleTrigger>
                <TraceLine status="succeeded">
                  <TraceTitle>Read job</TraceTitle>
                  <TraceDescription>integration-tests</TraceDescription>
                </TraceLine>
              </TraceCollapsibleTrigger>
            </TraceCollapsible>
            <TraceCollapsible defaultOpen>
              <TraceCollapsibleTrigger>
                <TraceLine status="succeeded">
                  <TraceTitle>Read logs of</TraceTitle>
                  <TraceDescription>Run tests</TraceDescription>
                </TraceLine>
              </TraceCollapsibleTrigger>
              <TraceCollapsibleContent>
                <TraceDetail>{logExcerpt}</TraceDetail>
              </TraceCollapsibleContent>
            </TraceCollapsible>
          </Trace>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  ),
};
