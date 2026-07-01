import type {Meta, StoryObj} from '@storybook/react';
import {ShinyText} from './shiny-text.js';

// The shimmer is a CSS keyframe animation, which the preview's framer-motion
// freeze does not cover. Playwright (Argos CI) sets navigator.webdriver, so
// disable the animation there to keep snapshots deterministic.
const skipAnimation = typeof navigator !== 'undefined' && navigator.webdriver === true;

const meta = {
  title: 'Components/ShinyText',
  component: ShinyText,
  tags: ['autodocs'],
  args: {
    text: 'Generating response…',
  },
  decorators: [
    (Story) => (
      <div className="p-16 text-sm">
        <Story />
      </div>
    ),
  ],
  render: ({disabled, ...args}) => <ShinyText {...args} disabled={disabled || skipAnimation} />,
} satisfies Meta<typeof ShinyText>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Disabled: Story = {
  args: {
    disabled: true,
  },
};
