import type {Meta, StoryObj} from '@storybook/react';
import {LoadErrorState} from './load-error-state.js';

const meta = {
  title: 'Components/LoadErrorState',
  component: LoadErrorState,
  tags: ['autodocs'],
  parameters: {layout: 'centered'},
  args: {onRetry: () => undefined},
} satisfies Meta<typeof LoadErrorState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <div className="w-400">
      <LoadErrorState {...args} />
    </div>
  ),
  args: {
    title: "Couldn't load integrations",
    description: 'Something went wrong. Check your connection and try again.',
    retryLabel: 'Retry loading integrations',
  },
};

export const Retrying: Story = {
  render: (args) => (
    <div className="w-400">
      <LoadErrorState {...args} />
    </div>
  ),
  args: {
    title: "Couldn't load members",
    description: 'We could not reach the server. Check your connection and try again.',
    retrying: true,
    retryLabel: 'Retry loading members',
  },
};
