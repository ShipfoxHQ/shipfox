import type {Meta, StoryObj} from '@storybook/react';
import {within} from 'storybook/test';
import {AgentStepConfigPanel} from './agent-step-config-panel.js';

const meta = {
  title: 'Workflows/RunView/AgentStepConfigPanel',
  component: AgentStepConfigPanel,
  parameters: {
    layout: 'centered',
  },
  decorators: [
    (Story) => (
      <div className="w-480 bg-background-components-base p-16">
        <Story />
      </div>
    ),
  ],
  args: {
    config: {
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      thinking: 'high',
    },
  },
} satisfies Meta<typeof AgentStepConfigPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Resolved: Story = {
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);

    await canvas.findByRole('region', {name: 'Resolved agent configuration'});
    await canvas.findByText('anthropic');
    await canvas.findByText('claude-opus-4-8');
    await canvas.findByText('high');
  },
};

export const MissingValues: Story = {
  args: {
    config: {
      provider: null,
      model: null,
      thinking: null,
    },
  },
};
