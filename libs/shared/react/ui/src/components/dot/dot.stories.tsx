import type {Meta, StoryObj} from '@storybook/react';
import {Code} from '#components/typography/index.js';
import {Dot, type DotVariant} from './dot.js';

const variants: DotVariant[] = ['neutral', 'info', 'feature', 'success', 'warning', 'error'];

const meta = {
  title: 'Components/Dot',
  component: Dot,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    variant: {control: 'select', options: variants},
    ripple: {control: 'boolean'},
  },
  args: {
    variant: 'neutral',
    ripple: false,
  },
} satisfies Meta<typeof Dot>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Ripple: Story = {
  args: {variant: 'info', ripple: true},
};

export const Variants: Story = {
  render: () => (
    <div className="flex flex-col gap-32">
      <div>
        <Code variant="label" className="mb-16 text-foreground-neutral-subtle">
          Static
        </Code>
        <div className="flex items-center gap-32">
          {variants.map((variant) => (
            <Dot key={variant} variant={variant} />
          ))}
        </div>
      </div>

      <div>
        <Code variant="label" className="mb-16 text-foreground-neutral-subtle">
          Ripple
        </Code>
        <div className="flex items-center gap-32">
          {variants.map((variant) => (
            <Dot key={variant} variant={variant} ripple />
          ))}
        </div>
      </div>
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-32">
      <Dot className="size-6" />
      <Dot className="size-8" />
      <Dot className="size-12" />
      <Dot variant="info" ripple className="size-12" />
    </div>
  ),
};
