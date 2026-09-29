import type {Meta, StoryObj} from '@storybook/react';
import {ModelLockBadge} from './model-lock-badge.js';

const meta = {
  title: 'Agent/ModelLockBadge',
  component: ModelLockBadge,
  args: {
    lock: {
      label: 'Add credits to use',
      message: 'This model needs a credit purchase. Add credits to run it in this workspace.',
    },
  },
} satisfies Meta<typeof ModelLockBadge>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const LongLabel: Story = {
  args: {
    lock: {
      label: 'Available on request from the workspace owner',
      message: 'Ask an owner to enable this model.',
    },
  },
};
