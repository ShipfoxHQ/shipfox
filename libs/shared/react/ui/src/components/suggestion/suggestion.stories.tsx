import type {Meta, StoryObj} from '@storybook/react';
import {Code} from '#components/typography/index.js';
import {Suggestion, Suggestions} from './suggestion.js';

const meta = {
  title: 'Components/Suggestion',
  component: Suggestion,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-400">
        <Story />
      </div>
    ),
  ],
  args: {
    suggestion: 'Why did this run fail?',
  },
} satisfies Meta<typeof Suggestion>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const States: Story = {
  render: (args) => (
    <div className="grid gap-16">
      {[
        {label: 'default', className: ''},
        {label: 'hover', className: 'hover'},
        {label: 'focus', className: 'focus'},
      ].map(({label, className}) => (
        <div key={label} className="grid gap-8">
          <Code variant="label" className="text-foreground-neutral-subtle">
            {label}
          </Code>
          <Suggestion {...args} className={className} />
        </div>
      ))}
      <div className="grid gap-8">
        <Code variant="label" className="text-foreground-neutral-subtle">
          disabled
        </Code>
        <Suggestion {...args} disabled />
      </div>
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
  render: (args) => (
    <div className="grid gap-8">
      <Suggestion {...args} suggestion="Explain this workflow" />
      <Suggestion
        {...args}
        suggestion="Compare this run with the last one that passed on main and list what changed in between"
      />
    </div>
  ),
};

export const Compositions: Story = {
  render: () => (
    <Suggestions>
      <Suggestion suggestion="Why did this run fail?" />
      <Suggestion suggestion="Summarize this run" />
      <Suggestion suggestion="What failed recently?" />
    </Suggestions>
  ),
};
